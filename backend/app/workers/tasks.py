import json
import logging
import threading
import time
from datetime import datetime, timezone
import redis
from croniter import croniter
from app.core.config import settings
from app.core.database import SessionLocal
from app.core.security import decrypt_secret
from app.models import (
    BackupJob, BackupFile, Server, Database, GoogleDriveAccount, BackupSchedule
)
from app.services.backup_engine import BackupEngine
from app.services.retention_service import RetentionService
from app.workers.celery_app import celery

logger = logging.getLogger(__name__)

def _get_redis_client():
    try:
        return redis.Redis.from_url(settings.REDIS_URL)
    except Exception:
        return None

def notify_progress(job_id: int, percent: int, step: str, extra: dict = None):
    r = _get_redis_client()
    payload = {
        "job_id": job_id,
        "progress_percent": percent,
        "current_step": step,
        **(extra or {})
    }
    if r:
        try:
            r.publish(f"backup_progress_{job_id}", json.dumps(payload))
            r.publish("global_backup_progress", json.dumps(payload))
        except Exception as e:
            logger.debug(f"Redis publish error: {e}")

def execute_backup_job_logic(job_id: int):
    db = SessionLocal()
    job = None
    try:
        job = db.query(BackupJob).filter(BackupJob.id == job_id).first()
        if not job:
            logger.error(f"BackupJob {job_id} no encontrado.")
            return

        job.status = "RUNNING"
        job.started_at = datetime.now(timezone.utc)
        job.progress_percent = 5
        job.current_step = "Iniciando motor de backup..."
        db.commit()
        notify_progress(job_id, 5, "Iniciando motor de backup...")

        # Get Google Drive Account
        drive_account = db.query(GoogleDriveAccount).filter(GoogleDriveAccount.is_active == True).first()
        if not drive_account or not drive_account.encrypted_token_json:
            raise RuntimeError("No hay una cuenta de Google Drive conectada o autorizada.")

        drive_token_json = decrypt_secret(drive_account.encrypted_token_json)
        if not drive_token_json:
            raise RuntimeError("Error al descifrar las credenciales de Google Drive.")

        server = job.server
        if not server:
            raise RuntimeError("El servidor asociado al backup no existe.")

        # Determine databases to backup
        databases_to_backup = []
        if job.schedule and job.schedule.databases:
            databases_to_backup = job.schedule.databases
        elif job.target_database_ids:
            try:
                selected_ids = json.loads(job.target_database_ids)
                if selected_ids:
                    databases_to_backup = db.query(Database).filter(
                        Database.server_id == server.id,
                        Database.id.in_(selected_ids)
                    ).all()
            except Exception as e:
                logger.error(f"Error parsing target_database_ids: {e}")
        
        if not databases_to_backup:
            # Fallback if no specific selection was given
            databases_to_backup = db.query(Database).filter(Database.server_id == server.id).all()

        total_dbs = len(databases_to_backup)
        if total_dbs == 0:
            raise RuntimeError("No se encontraron bases de datos seleccionadas para respaldar.")

        # Send start alert
        try:
            from app.services.alert_service import AlertService
            AlertService.send_alert(
                title=f"🚀 INICIO DE RESPALDO: Base de Datos #{job.id}",
                message=f"Se ha iniciado el respaldo del servidor '{server.name}'. Total BDs a respaldar: {total_dbs}.",
                severity="START",
                details={
                    "Servidor": server.name,
                    "Total Bases de Datos": f"{total_dbs}",
                    "Tipo": job.trigger_type,
                    "Destino": f"Google Drive ({drive_account.root_folder_name or 'BACKUPS'})"
                }
            )
        except Exception as se:
            logger.warning(f"Error sending start alert: {se}")

        total_original = 0
        total_compressed = 0

        # Checkpoints: detect already completed databases for this job
        completed_file_map = {bf.database_id: bf for bf in job.backup_files if bf.status == "COMPLETED"}

        progress_lock = threading.Lock()
        last_progress_time = [0.0]

        for idx, database in enumerate(databases_to_backup):
            db_num = idx + 1
            base_pct = int(((idx) / total_dbs) * 90)

            # If already backed up and saved to Drive in a previous run of this job, skip it!
            if database.id in completed_file_map:
                existing_file = completed_file_map[database.id]
                total_original += existing_file.original_db_size_bytes or 0
                total_compressed += existing_file.file_size_bytes or 0
                logger.info(f"Checkpoint: Base de datos '{database.name}' ({db_num}/{total_dbs}) ya respaldada en Google Drive. Omitiendo.")
                continue

            def sub_progress(sub_pct, sub_step):
                # Scale sub_pct into overall job percentage
                overall = int(base_pct + (sub_pct / 100.0) * (90 / total_dbs))
                step_str = f"[{db_num}/{total_dbs}] {database.name}: {sub_step}"

                with progress_lock:
                    now_t = time.time()
                    # Throttle database write to avoid transaction collisions across async threads
                    if now_t - last_progress_time[0] >= 1.5 or sub_pct >= 95 or sub_pct <= 20:
                        last_progress_time[0] = now_t
                        try:
                            db_prog = SessionLocal()
                            j = db_prog.query(BackupJob).filter(BackupJob.id == job_id).first()
                            if j:
                                j.progress_percent = overall
                                j.current_step = step_str
                                db_prog.commit()
                            db_prog.close()
                        except Exception as pe:
                            logger.debug(f"Error actualizando progreso en DB: {pe}")

                notify_progress(job_id, overall, step_str, {
                    "database": database.name,
                    "db_index": db_num,
                    "total_dbs": total_dbs
                })

            notify_progress(job_id, base_pct, f"[{db_num}/{total_dbs}] Respaldando {database.name}...")

            backup_res = BackupEngine.run_database_backup(
                server=server,
                database=database,
                drive_token_json=drive_token_json,
                root_folder_name=drive_account.root_folder_name or "BACKUPS",
                progress_callback=sub_progress
            )

            # Record BackupFile
            b_file = BackupFile(
                job_id=job.id,
                database_id=database.id,
                file_name=backup_res["file_name"],
                file_size_bytes=backup_res["file_size_bytes"],
                original_db_size_bytes=backup_res["original_db_size_bytes"],
                sha256_checksum=backup_res["sha256_checksum"],
                compression_algorithm="gzip",
                google_drive_file_id=backup_res["google_drive_file_id"],
                google_drive_path=backup_res["google_drive_path"],
                status="COMPLETED"
            )
            db.add(b_file)

            # Update database record metrics
            database.last_backup_at = datetime.now(timezone.utc)
            database.last_backup_size_bytes = backup_res["file_size_bytes"]
            database.last_backup_status = "SUCCESS"

            total_original += backup_res["original_db_size_bytes"]
            total_compressed += backup_res["file_size_bytes"]
            db.commit()

            # Apply retention policy if triggered from schedule
            if job.schedule:
                RetentionService.apply_retention_policy(
                    db=db,
                    schedule=job.schedule,
                    database_id=database.id,
                    drive_token_json=drive_token_json
                )

        job.status = "COMPLETED"
        job.progress_percent = 100
        job.current_step = "Backup completado y verificado en Google Drive."
        job.finished_at = datetime.now(timezone.utc)
        job.total_original_size_bytes = total_original
        job.total_compressed_size_bytes = total_compressed
        db.commit()
        notify_progress(job_id, 100, "Backup completado con éxito.")

        try:
            from app.services.alert_service import AlertService
            AlertService.send_alert(
                title=f"Backup de Base de Datos Exitoso #{job.id}",
                message=f"Servidor: {job.server.name if job.server else 'N/A'}. Tamaño: {round(total_compressed/(1024*1024), 2)} MB.",
                severity="SUCCESS",
                details={"Job ID": job.id, "Servidor": job.server.name if job.server else "N/A"}
            )
        except Exception:
            pass

        try:
            if drive_token_json:
                from app.services.google_drive_service import GoogleDriveService
                GoogleDriveService.check_and_alert_quota(drive_token_json, db=db)
        except Exception:
            pass


    except Exception as e:
        logger.error(f"Fallo en BackupJob {job_id}: {str(e)}", exc_info=True)
        try:
            db.rollback()
        except Exception:
            pass
        try:
            db_err = SessionLocal()
            j_err = db_err.query(BackupJob).filter(BackupJob.id == job_id).first()
            if j_err:
                j_err.status = "FAILED"
                j_err.error_message = str(e)
                j_err.finished_at = datetime.now(timezone.utc)
                j_err.current_step = f"Error: {str(e)}"
                db_err.commit()
            db_err.close()
        except Exception as commit_err:
            logger.error(f"Error registrando estado FAILED en DB: {commit_err}")

        notify_progress(job_id, job.progress_percent if job else 0, f"Fallo: {str(e)}")

        try:
            from app.services.alert_service import AlertService
            AlertService.send_alert(
                title=f"Fallo en Backup de Base de Datos #{job.id}",
                message=f"Servidor: {job.server.name if job.server else 'N/A'}. Error: {e}",
                severity="ERROR",
                details={"Job ID": job.id, "Error": str(e)[:200]}
            )
        except Exception:
            pass
    finally:
        db.close()

@celery.task(bind=True, max_retries=3)
def run_backup_job(self, job_id: int):
    return execute_backup_job_logic(job_id)

def trigger_single_schedule(db, sched: BackupSchedule, user_id=None):
    """Triggers a backup job from schedule (either database or folder)"""
    now = datetime.now(timezone.utc)
    if sched.schedule_type == "FOLDER":
        from app.models import FolderBackupJob, Branch
        from app.services.folder_backup_engine import execute_folder_backup_job_logic
        target_branch_ids = []
        if sched.target_branch_ids:
            try:
                target_branch_ids = json.loads(sched.target_branch_ids)
            except Exception:
                pass
        if not target_branch_ids:
            all_b = db.query(Branch).filter(Branch.is_active == True).all()
            target_branch_ids = [b.id for b in all_b]

        subfolders = None
        if sched.folder_scope == 'critical':
            subfolders = ['Data', 'Datos', 'DataSQL', 'Formularios']
        elif sched.folder_scope == 'custom':
            if sched.target_subfolders:
                if isinstance(sched.target_subfolders, list):
                    subfolders = sched.target_subfolders
                else:
                    try:
                        subfolders = json.loads(sched.target_subfolders)
                    except Exception:
                        subfolders = None
        elif sched.folder_scope == 'all':
            subfolders = None

        job = FolderBackupJob(
            job_name=f"[Prog] {sched.name} - {now.strftime('%Y-%m-%d %H:%M')}",
            target_branch_ids=json.dumps(target_branch_ids),
            target_subfolders=json.dumps(subfolders) if subfolders else None,
            user_id=user_id,
            status="PENDING",
            progress_percent=0,
            current_step="Encolado automáticamente por programación de carpetas",
            total_branches=len(target_branch_ids)
        )
        db.add(job)
        db.commit()
        db.refresh(job)

        t = threading.Thread(target=execute_folder_backup_job_logic, args=(job.id,))
        t.daemon = True
        t.start()
        return job
    else:
        job = BackupJob(
            server_id=sched.server_id,
            schedule_id=sched.id,
            trigger_type="SCHEDULED",
            status="PENDING",
            progress_percent=0,
            current_step="Encolado automáticamente por programación de bases de datos"
        )
        db.add(job)
        db.commit()
        db.refresh(job)

        t = threading.Thread(target=execute_backup_job_logic, args=(job.id,))
        t.daemon = True
        t.start()
        return job

def check_scheduled_backups():
    """Checks for due automated schedules and triggers their jobs using local system time"""
    db = SessionLocal()
    try:
        now = datetime.now()
        schedules = db.query(BackupSchedule).filter(
            BackupSchedule.is_active == True,
            BackupSchedule.next_run_at <= now
        ).all()

        for sched in schedules:
            logger.info(f"Disparando backup programado: {sched.name} (Tipo: {sched.schedule_type}, ID: {sched.id})")
            trigger_single_schedule(db, sched)

            sched.last_run_at = now
            try:
                c = croniter(sched.cron_expression, now)
                sched.next_run_at = c.get_next(datetime)
            except Exception:
                pass
            db.commit()

    except Exception as e:
        logger.error(f"Error verificando schedules: {e}")
    finally:
        db.close()

def start_scheduler_loop(stop_event: threading.Event):
    """Background daemon thread checking schedules every 30 seconds"""
    logger.info("Scheduler daemon iniciado. Verificando programaciones cada 30 segundos...")
    while not stop_event.is_set():
        try:
            check_scheduled_backups()
        except Exception as e:
            logger.error(f"Error en scheduler daemon: {e}")
        stop_event.wait(30)

