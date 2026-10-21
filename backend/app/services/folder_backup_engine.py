import os
import time
import json
import logging
import tarfile
import threading
import concurrent.futures
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Callable
from app.core.database import SessionLocal
from app.models import Branch, FolderBackupJob, FolderBackupFile, GoogleDriveAccount
from app.services.google_drive_service import GoogleDriveService


# Optimization: Increase tarfile copyfileobj buffer from 16KB to 1MB for high-speed SMB network reads
_orig_copyfileobj = tarfile.copyfileobj
def _fast_copyfileobj(src, dst, length=None, exception=OSError, bufsize=None):
    return _orig_copyfileobj(src, dst, length=length, exception=exception, bufsize=bufsize or (1024 * 1024))
tarfile.copyfileobj = _fast_copyfileobj

from app.core.security import decrypt_secret

logger = logging.getLogger(__name__)

import queue

class ChunkedQueueStream:
    """
    High-performance thread-safe memory queue replacing os.pipe().
    Buffers up to 64MB of tar stream in memory so the producer (SMB scanner/reader)
    never stalls when Google Drive is transmitting chunks over HTTP.
    """
    def __init__(self, maxsize: int = 32):
        self.q = queue.Queue(maxsize=maxsize)
        self.chunk = b""
        self.pos = 0

    def write(self, b: bytes) -> int:
        if not b:
            return 0
        self.q.put(bytes(b))
        return len(b)

    def close(self):
        self.q.put(None)

    def read(self, n: int = -1) -> bytes:
        if not self.chunk or self.pos >= len(self.chunk):
            item = self.q.get()
            if item is None:
                return b""
            self.chunk = item
            self.pos = 0
        avail = len(self.chunk) - self.pos
        if n < 0 or n >= avail:
            res = self.chunk[self.pos:]
            self.pos = len(self.chunk)
            return res
        else:
            res = self.chunk[self.pos : self.pos + n]
            self.pos += n
            return res

class FolderBackupEngine:
    @classmethod
    def run_branch_folder_backup(
        cls,
        branch: Branch,
        drive_token_json: str,
        subfolders: Optional[List[str]] = None,
        exclude_subfolders: Optional[List[str]] = None,
        root_folder_name: str = "BACKUPS",
        progress_callback: Optional[Callable[[int, str], None]] = None
    ) -> Dict[str, Any]:
        """
        Pipes files from branch UNC path through an in-memory tar stream
        compressed with gzip directly to Google Drive via resumable upload.
        Disk usage on host machine: 0 Bytes.
        """
        unc_path = branch.unc_path
        if not os.path.exists(unc_path):
            raise FileNotFoundError(f"Ruta de red inaccesible o no encontrada: {unc_path}")

        # Formato de fecha y hora local para nombre de archivo: YYYY-MM-DD_HH-mm-ss
        timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        clean_code = branch.code.strip().upper()
        filename = f"backup_{clean_code}_{timestamp}.tar.gz"

        if progress_callback:
            progress_callback(10, f"Verificando / creando carpeta '{clean_code}' en Google Drive...")

        # Si es la primera vez que se respalda esta tienda, crea la carpeta clean_code (ej. 'AK01')
        target_folder_id = GoogleDriveService.resolve_folder_backup_path(
            token_json=drive_token_json,
            root_folder_name=root_folder_name,
            branch_code=clean_code,
            branch_name=branch.name
        )

        # High-performance async queue buffer replacing os.pipe (expanded to 64 chunks)
        queue_stream = ChunkedQueueStream(maxsize=64)

        producer_stats = {
            "files_added": 0,
            "raw_bytes": 0,
            "error": None
        }

        def produce_tar():
            try:
                with tarfile.open(fileobj=queue_stream, mode='w|') as tar:
                    target_dirs = []
                    if subfolders and len(subfolders) > 0:
                        for sf in subfolders:
                            full_sub = os.path.join(unc_path, sf)
                            if os.path.exists(full_sub):
                                target_dirs.append((full_sub, sf))
                    else:
                        target_dirs.append((unc_path, ""))

                    excludes_set = set(x.lower() for x in (exclude_subfolders or []))
                    # Automatically exclude bulky static or historical directories if full folder backup is requested
                    if not subfolders or len(subfolders) == 0:
                        excludes_set.update({'datoshis', 'datahis', 'desinstalar', 'bmp', 'ico', 'icons', 'imagenes', 'jpg', 'tmp', 'log', 'logerr'})

                    # Skip temporary, lock, and residual backup files that waste bandwidth (allow .exe)
                    skip_extensions = (
                        '.tmp', '.temp', '.~df', '.~db', 'thumbs.db', 'desktop.ini',
                        '.bak', '.old', '.log'
                    )

                    def scan_and_add(dir_path: str, arc_prefix: str):
                        try:
                            with os.scandir(dir_path) as it:
                                for entry in it:
                                    try:
                                        name_lower = entry.name.lower()
                                        if name_lower in excludes_set:
                                            continue
                                        if name_lower.endswith(skip_extensions):
                                            continue

                                        rel_arc = os.path.join(arc_prefix, entry.name) if arc_prefix else entry.name

                                        if entry.is_dir(follow_symlinks=False):
                                            scan_and_add(entry.path, rel_arc)
                                        elif entry.is_file(follow_symlinks=False):
                                            st = entry.stat()
                                            tarinfo = tarfile.TarInfo(name=rel_arc)
                                            tarinfo.size = st.st_size
                                            tarinfo.mtime = st.st_mtime
                                            tarinfo.mode = 0o644

                                            # 2MB buffer for massive SMB network reading throughput (up to 1.5GB/s)
                                            with open(entry.path, 'rb', buffering=2 * 1024 * 1024) as f:
                                                tar.addfile(tarinfo, f)
                                            producer_stats["files_added"] += 1
                                            producer_stats["raw_bytes"] += st.st_size
                                    except Exception as fe:
                                        logger.warning(f"Omitiendo archivo {entry.path} ({fe})")
                        except Exception as de:
                            logger.warning(f"Error accediendo a directorio {dir_path}: {de}")

                    for root_dir, arc_prefix in target_dirs:
                        if os.path.isdir(root_dir):
                            scan_and_add(root_dir, arc_prefix)
            except Exception as e:
                logger.error(f"Error en empaquetado de carpeta para {branch.code}: {e}")
                producer_stats["error"] = e
            finally:
                try:
                    queue_stream.close()
                except Exception:
                    pass

        t = threading.Thread(target=produce_tar, daemon=True)
        t.start()

        def stream_progress(raw_read: int, comp_sent: int):
            raw_mb = raw_read // (1024 * 1024)
            comp_mb = comp_sent // (1024 * 1024)
            raw_gb = round(raw_read / (1024 ** 3), 2)
            comp_gb = round(comp_sent / (1024 ** 3), 2)
            if progress_callback:
                if raw_gb >= 1.0 or comp_gb >= 1.0:
                    txt = f"Transmitiendo en bloques de 16MB... ({raw_gb} GB leídos, {comp_gb} GB subidos)"
                else:
                    txt = f"Transmitiendo en bloques de 16MB... ({raw_mb} MB leídos, {comp_mb} MB subidos)"
                try:
                    progress_callback(50, txt, raw_mb, comp_mb)
                except TypeError:
                    progress_callback(50, txt)

        if progress_callback:
            progress_callback(20, f"Iniciando lectura acelerada y transmisión de {branch.code}...")

        try:
            upload_res = GoogleDriveService.upload_stream_resumable(
                token_json=drive_token_json,
                stream_reader=queue_stream,
                destination_folder_id=target_folder_id,
                remote_filename=filename,
                compress=True,
                progress_callback=stream_progress
            )
        finally:
            try:
                queue_stream.close()
            except Exception:
                pass
            t.join(timeout=30)

        if producer_stats["error"]:
            raise producer_stats["error"]

        if progress_callback:
            progress_callback(98, f"Respaldo de {branch.code} completado exitosamente en Google Drive.")

        clean_code = branch.code.strip().upper()
        return {
            "file_name": filename,
            "file_size_bytes": upload_res["compressed_size_bytes"],
            "raw_size_bytes": upload_res["raw_size_bytes"],
            "sha256_checksum": upload_res["sha256_checksum"],
            "google_drive_file_id": upload_res["id"],
            "google_drive_path": f"{root_folder_name}/CARPETAS_SUCURSALES/{clean_code}/{filename}",
            "files_added": producer_stats["files_added"]
        }


def execute_folder_backup_job_logic(job_id: int) -> None:
    """Background worker for multi-branch folder backup jobs with checkpoints"""
    db = SessionLocal()
    job = None
    try:
        job = db.query(FolderBackupJob).filter(FolderBackupJob.id == job_id).first()
        if not job:
            logger.error(f"FolderBackupJob #{job_id} no encontrado.")
            return

        job.status = "RUNNING"
        job.error_message = None
        job.started_at = datetime.now(timezone.utc)
        job.progress_percent = 5
        job.current_step = "Iniciando motor de respaldo de carpetas..."
        db.commit()

        drive_account = db.query(GoogleDriveAccount).filter(GoogleDriveAccount.is_active == True).first()
        if not drive_account or not drive_account.encrypted_token_json:
            raise RuntimeError("No hay una cuenta activa de Google Drive configurada.")

        token_json = decrypt_secret(drive_account.encrypted_token_json)
        if not token_json:
            raise RuntimeError("No se pudieron descifrar las credenciales de Google Drive.")

        branches_to_backup = []
        if job.target_branch_ids:
            try:
                b_ids = json.loads(job.target_branch_ids)
                if b_ids:
                    branches_to_backup = db.query(Branch).filter(Branch.id.in_(b_ids)).all()
            except Exception:
                pass

        if not branches_to_backup:
            branches_to_backup = db.query(Branch).filter(Branch.is_active == True).all()

        total_branches = len(branches_to_backup)
        job.total_branches = total_branches
        db.commit()

        subfolders = []
        if job.target_subfolders:
            try:
                subfolders = json.loads(job.target_subfolders)
            except Exception:
                pass

        # Send start alert to Telegram / configured channels
        try:
            from app.services.alert_service import AlertService
            scope_desc = "Personalizado" if subfolders else "Crítico / Estándar"
            AlertService.send_alert(
                title=f"🚀 INICIO DE RESPALDO: Carpetas de Tiendas #{job.id}",
                message=f"Se ha iniciado la tarea '{job.job_name}'. Se procesarán {total_branches} sucursales en paralelo (concurrencia x3) con reintentos inteligentes.",
                severity="START",
                details={
                    "Tarea": job.job_name,
                    "Total Tiendas": f"{total_branches}",
                    "Alcance": scope_desc,
                    "Destino": f"Google Drive ({drive_account.root_folder_name or 'BACKUPS'}/CARPETAS_SUCURSALES)"
                }
            )
        except Exception as se:
            logger.warning(f"Error sending start alert: {se}")

        # Check Google Drive storage quota at job start (warning if >= 85%)
        try:
            GoogleDriveService.check_and_alert_quota(token_json, db=db)
        except Exception as qe:
            logger.warning(f"Error checking drive quota at job start: {qe}")

        # Check existing completed files for checkpoint resume
        existing_completed = db.query(FolderBackupFile).filter(
            FolderBackupFile.job_id == job.id,
            FolderBackupFile.status == 'COMPLETED'
        ).all()
        already_completed_branch_ids = set(f.branch_id for f in existing_completed)

        pending_branches = [b for b in branches_to_backup if b.id not in already_completed_branch_ids]
        job.completed_branches = len(already_completed_branch_ids)
        job.total_size_bytes = sum((f.file_size_bytes or 0) for f in existing_completed)
        db.commit()

        db_lock = threading.Lock()
        active_branches_lock = threading.Lock()
        active_branch_stats = {}  # branch.code -> {"raw_mb": int, "comp_mb": int}
        last_progress_tick = [0.0]

        def update_job_progress():
            with db_lock:
                try:
                    db_prog = SessionLocal()
                    j = db_prog.query(FolderBackupJob).filter(FolderBackupJob.id == job.id).first()
                    if j:
                        all_c = db_prog.query(FolderBackupFile).filter(
                            FolderBackupFile.job_id == job.id,
                            FolderBackupFile.status == 'COMPLETED'
                        ).all()
                        j.completed_branches = len(all_c)
                        j.total_size_bytes = sum((f.file_size_bytes or 0) for f in all_c)
                        base_pct = int((len(all_c) / total_branches) * 90) if total_branches > 0 else 5
                        j.progress_percent = min(max(base_pct, 5), 95)
                        with active_branches_lock:
                            if active_branch_stats:
                                parts = []
                                for code, st in active_branch_stats.items():
                                    comp = st.get("comp_mb", 0)
                                    raw = st.get("raw_mb", 0)
                                    if comp > 0:
                                        parts.append(f"{code} ({comp}MB)")
                                    elif raw > 0:
                                        parts.append(f"{code} (leyendo {raw}MB)")
                                    else:
                                        parts.append(code)
                                active_str = ", ".join(parts)
                            else:
                                active_str = "Finalizando..."
                        j.current_step = f"Respaldando en paralelo (hasta 3 tiendas) [{j.completed_branches}/{total_branches} listas] • {active_str}"
                        db_prog.commit()
                    db_prog.close()
                except Exception as ex:
                    logger.debug(f"Progress update error: {ex}")

        def process_branch(branch: Branch):
            with active_branches_lock:
                active_branch_stats[branch.code] = {"raw_mb": 0, "comp_mb": 0}
            update_job_progress()

            max_retries = 2
            retry_delay = 30
            last_error = None

            for attempt in range(1 + max_retries):
                try:
                    if attempt > 0:
                        logger.info(f"Reintento {attempt}/{max_retries} para {branch.code} tras espera de red...")

                    def sub_progress(sub_pct: int, msg: str, raw_mb: int = 0, comp_mb: int = 0):
                        with active_branches_lock:
                            active_branch_stats[branch.code] = {"raw_mb": raw_mb, "comp_mb": comp_mb}
                        now_t = time.time()
                        if now_t - last_progress_tick[0] >= 2.0:
                            last_progress_tick[0] = now_t
                            update_job_progress()

                    res = FolderBackupEngine.run_branch_folder_backup(
                        branch=branch,
                        drive_token_json=token_json,
                        subfolders=subfolders,
                        root_folder_name=drive_account.root_folder_name or "BACKUPS",
                        progress_callback=sub_progress
                    )

                    with db_lock:
                        db_w = SessionLocal()
                        try:
                            existing_old = db_w.query(FolderBackupFile).filter(
                                FolderBackupFile.job_id == job.id,
                                FolderBackupFile.branch_id == branch.id
                            ).all()
                            for old_f in existing_old:
                                if old_f.google_drive_file_id and old_f.google_drive_file_id != res["google_drive_file_id"]:
                                    try:
                                        GoogleDriveService.delete_file(token_json, old_f.google_drive_file_id)
                                    except Exception:
                                        pass
                                db_w.delete(old_f)
                            db_w.flush()

                            b_file = FolderBackupFile(
                                job_id=job.id,
                                branch_id=branch.id,
                                file_name=res["file_name"],
                                file_size_bytes=res["file_size_bytes"],
                                raw_size_bytes=res["raw_size_bytes"],
                                sha256_checksum=res["sha256_checksum"],
                                google_drive_file_id=res["google_drive_file_id"],
                                google_drive_path=res["google_drive_path"],
                                subfolders_included=", ".join(subfolders) if subfolders else "Todo",
                                status="COMPLETED"
                            )
                            db_w.add(b_file)

                            b_ref = db_w.query(Branch).filter(Branch.id == branch.id).first()
                            if b_ref:
                                b_ref.last_backup_at = datetime.now(timezone.utc)
                                b_ref.last_backup_size_bytes = res["file_size_bytes"]

                            db_w.commit()
                        finally:
                            db_w.close()

                    last_error = None
                    break
                except Exception as be:
                    last_error = be
                    if attempt < max_retries:
                        logger.warning(f"Error temporal en {branch.code}: {be}. Reintentando ({attempt + 1}/{max_retries}) en {retry_delay}s...")
                        with db_lock:
                            try:
                                db_step = SessionLocal()
                                j = db_step.query(FolderBackupJob).filter(FolderBackupJob.id == job.id).first()
                                if j:
                                    j.current_step = f"Reintentando {branch.code} ({attempt + 1}/{max_retries}) en {retry_delay}s tras microcorte..."
                                    db_step.commit()
                                db_step.close()
                            except Exception:
                                pass
                        time.sleep(retry_delay)
                    else:
                        logger.error(f"Fallo definitivo tras {max_retries} reintentos en {branch.code}: {be}")

            with active_branches_lock:
                active_branch_stats.pop(branch.code, None)

            update_job_progress()
            if last_error:
                with db_lock:
                    try:
                        db_err = SessionLocal()
                        j = db_err.query(FolderBackupJob).filter(FolderBackupJob.id == job.id).first()
                        if j:
                            j.error_message = f"Error en {branch.code}: {last_error}"
                            db_err.commit()
                        db_err.close()
                    except Exception:
                        pass

        # Execute pending branches concurrently with 3 workers
        if pending_branches:
            with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
                futures = [executor.submit(process_branch, b) for b in pending_branches]
                concurrent.futures.wait(futures)


        all_final_files = db.query(FolderBackupFile).filter(
            FolderBackupFile.job_id == job.id,
            FolderBackupFile.status == "COMPLETED"
        ).all()
        job.completed_branches = len(all_final_files)
        job.total_size_bytes = sum((f.file_size_bytes or 0) for f in all_final_files)

        if job.completed_branches == 0 and total_branches > 0:
            job.status = "FAILED"
            job.progress_percent = 100
            if not job.error_message:
                job.error_message = "No se pudo respaldar ninguna sucursal."
            job.current_step = f"Error: No se respaldó ninguna de las {total_branches} sucursales."
        elif job.completed_branches < total_branches:
            job.status = "COMPLETED"  # Completado parcial
            job.progress_percent = 100
            job.current_step = f"Completado parcialmente ({job.completed_branches}/{total_branches} sucursales respaldadas)."
        else:
            job.status = "COMPLETED"
            job.progress_percent = 100
            job.current_step = "Respaldo de carpetas completado exitosamente en Google Drive."

        job.finished_at = datetime.now(timezone.utc)
        db.commit()

        try:
            from app.services.alert_service import AlertService
            if job.status == "COMPLETED":
                AlertService.send_alert(
                    title=f"Respaldo de Carpetas #{job.id}",
                    message=f"La tarea '{job.job_name}' completó {job.completed_branches}/{job.total_branches} sucursales.",
                    severity="SUCCESS" if job.completed_branches == total_branches else "WARNING",
                    details={"Tarea": job.job_name, "Sucursales": f"{job.completed_branches}/{job.total_branches}", "Tamaño Total": f"{round((job.total_size_bytes or 0)/(1024*1024*1024), 2)} GB"}
                )
            else:
                AlertService.send_alert(
                    title=f"Fallo en Respaldo de Carpetas #{job.id}",
                    message=f"La tarea '{job.job_name}' falló: {job.error_message}",
                    severity="ERROR",
                    details={"Tarea": job.job_name, "Error": str(job.error_message)[:200]}
                )
        except Exception:
            pass

        try:
            GoogleDriveService.check_and_alert_quota(token_json, db=db)
        except Exception:
            pass


    except Exception as e:
        logger.error(f"Error general en FolderBackupJob #{job_id}: {e}")
        if job:
            job.status = "FAILED"
            job.error_message = str(e)
            job.finished_at = datetime.now(timezone.utc)
            db.commit()

            try:
                from app.services.alert_service import AlertService
                AlertService.send_alert(
                    title=f"Fallo en Respaldo de Carpetas #{job.id}",
                    message=f"La tarea '{job.job_name}' falló: {e}",
                    severity="ERROR",
                    details={"Tarea": job.job_name, "Error": str(e)[:200]}
                )
            except Exception:
                pass
    finally:
        db.close()
