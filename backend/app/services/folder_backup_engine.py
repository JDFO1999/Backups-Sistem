import os
import json
import logging
import tarfile
import threading
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

        r_fd, w_fd = os.pipe()
        pipe_reader = os.fdopen(r_fd, 'rb')
        pipe_writer = os.fdopen(w_fd, 'wb')

        producer_stats = {
            "files_added": 0,
            "raw_bytes": 0,
            "error": None
        }

        def produce_tar():
            try:
                with tarfile.open(fileobj=pipe_writer, mode='w|') as tar:
                    target_dirs = []
                    if subfolders and len(subfolders) > 0:
                        for sf in subfolders:
                            full_sub = os.path.join(unc_path, sf)
                            if os.path.exists(full_sub):
                                target_dirs.append((full_sub, sf))
                    else:
                        target_dirs.append((unc_path, ""))

                    excludes_set = set(x.lower() for x in (exclude_subfolders or []))
                    for root_dir, arc_prefix in target_dirs:
                        for dirpath, dirnames, filenames in os.walk(root_dir):
                            if excludes_set:
                                dirnames[:] = [d for d in dirnames if d.lower() not in excludes_set]
                            rel = os.path.relpath(dirpath, root_dir)
                            arc_dir = os.path.normpath(os.path.join(arc_prefix, rel)) if rel != "." else (arc_prefix or "")
                            
                            for fname in filenames:
                                file_path = os.path.join(dirpath, fname)
                                arcname = os.path.join(arc_dir, fname) if arc_dir else fname
                                try:
                                    fstat = os.stat(file_path)
                                    tar.add(file_path, arcname=arcname, recursive=False)
                                    producer_stats["files_added"] += 1
                                    producer_stats["raw_bytes"] += fstat.st_size
                                except Exception as fe:
                                    logger.warning(f"Omitiendo archivo {file_path} ({fe})")
            except Exception as e:
                logger.error(f"Error en empaquetado de carpeta para {branch.code}: {e}")
                producer_stats["error"] = e
            finally:
                try:
                    pipe_writer.close()
                except Exception:
                    pass

        t = threading.Thread(target=produce_tar, daemon=True)
        t.start()

        def stream_progress(raw_read: int, comp_sent: int):
            raw_mb = raw_read // (1024 * 1024)
            comp_mb = comp_sent // (1024 * 1024)
            if progress_callback:
                progress_callback(50, f"Transmitiendo a Google Drive... ({raw_mb} MB leídos, {comp_mb} MB subidos)")

        if progress_callback:
            progress_callback(20, f"Iniciando empaquetado y subida en tiempo real de {branch.code}...")

        try:
            upload_res = GoogleDriveService.upload_stream_resumable(
                token_json=drive_token_json,
                stream_reader=pipe_reader,
                destination_folder_id=target_folder_id,
                remote_filename=filename,
                compress=True,
                progress_callback=stream_progress
            )
        finally:
            try:
                pipe_reader.close()
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

        total_compressed_bytes = 0

        for idx, branch in enumerate(branches_to_backup, start=1):
            # Checkpoint: Check if already backed up in this job
            existing_file = db.query(FolderBackupFile).filter(
                FolderBackupFile.job_id == job.id,
                FolderBackupFile.branch_id == branch.id,
                FolderBackupFile.status == 'COMPLETED'
            ).first()

            if existing_file:
                logger.info(f"Checkpoint: Sucursal '{branch.code}' ({idx}/{total_branches}) ya respaldada. Omitiendo.")
                total_compressed_bytes += (existing_file.file_size_bytes or 0)
                continue

            base_pct = int(((idx - 1) / total_branches) * 90) + 5
            job.current_step = f"[{idx}/{total_branches}] {branch.code} - {branch.name}: Preparando respaldo..."
            job.progress_percent = base_pct
            db.commit()

            def sub_progress(sub_pct: int, msg: str):
                try:
                    mapped = int(base_pct + (sub_pct * (90 / total_branches) / 100))
                    job.progress_percent = min(mapped, 95)
                    job.current_step = f"[{idx}/{total_branches}] {branch.code}: {msg}"
                    db.commit()
                except Exception:
                    pass

            try:
                res = FolderBackupEngine.run_branch_folder_backup(
                    branch=branch,
                    drive_token_json=token_json,
                    subfolders=subfolders,
                    root_folder_name=drive_account.root_folder_name or "BACKUPS",
                    progress_callback=sub_progress
                )

                # Ensure no duplicate file record for this branch in this job
                existing_old = db.query(FolderBackupFile).filter(
                    FolderBackupFile.job_id == job.id,
                    FolderBackupFile.branch_id == branch.id
                ).all()
                for old_f in existing_old:
                    if old_f.google_drive_file_id and old_f.google_drive_file_id != res["google_drive_file_id"]:
                        try:
                            GoogleDriveService.delete_file(token_json, old_f.google_drive_file_id)
                        except Exception:
                            pass
                    db.delete(old_f)
                db.flush()

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
                db.add(b_file)
                db.flush()

                branch.last_backup_at = datetime.now(timezone.utc)
                branch.last_backup_size_bytes = res["file_size_bytes"]
                
                # Accurately compute job total size and count from current files
                all_job_files = db.query(FolderBackupFile).filter(
                    FolderBackupFile.job_id == job.id,
                    FolderBackupFile.status == "COMPLETED"
                ).all()
                job.completed_branches = len(all_job_files)
                job.total_size_bytes = sum((f.file_size_bytes or 0) for f in all_job_files)
                db.commit()

            except Exception as be:
                logger.error(f"Fallo respaldando sucursal {branch.code}: {be}")
                job.current_step = f"Error en {branch.code}: {be}"
                job.error_message = f"Error en {branch.code}: {be}"
                db.commit()
                # Continue with other branches or record failure
                continue

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
