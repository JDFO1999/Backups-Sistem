import threading
from typing import List, Optional
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.deps import get_current_user, get_client_ip
from app.models import BackupJob, BackupFile, Server, Database, GoogleDriveAccount, User, RestoreJob
from app.schemas.backup import (
    BackupJobCreate, BackupJobResponse, BackupFileResponse, BackupProgressResponse
)
from app.schemas.restore import RestoreRequest, RestoreJobResponse
from app.services.restore_engine import RestoreEngine
from app.services.audit_service import log_audit
from app.utils.formatters import format_bytes


router = APIRouter()

def _format_file(f: BackupFile) -> BackupFileResponse:
    return BackupFileResponse(
        id=f.id,
        database_id=f.database_id,
        database_name=f.database.name if f.database else "Desconocida",
        file_name=f.file_name,
        file_size_bytes=f.file_size_bytes or 0,
        file_size_formatted=format_bytes(f.file_size_bytes or 0),
        original_db_size_bytes=f.original_db_size_bytes or 0,
        original_size_formatted=format_bytes(f.original_db_size_bytes or 0),
        sha256_checksum=f.sha256_checksum,
        compression_algorithm=f.compression_algorithm or "gzip",
        google_drive_file_id=f.google_drive_file_id,
        google_drive_path=f.google_drive_path,
        status=f.status,
        created_at=f.created_at
    )

def _format_job(j: BackupJob) -> BackupJobResponse:
    return BackupJobResponse(
        id=j.id,
        server_id=j.server_id,
        server_name=j.server.name if j.server else "Desconocido",
        trigger_type=j.trigger_type,
        status=j.status,
        progress_percent=j.progress_percent,
        current_step=j.current_step,
        error_message=j.error_message,
        total_original_size_bytes=j.total_original_size_bytes or 0,
        total_compressed_size_bytes=j.total_compressed_size_bytes or 0,
        started_at=j.started_at,
        finished_at=j.finished_at,
        created_at=j.created_at,
        files=[_format_file(f) for f in j.backup_files]
    )

@router.post("", response_model=BackupJobResponse, status_code=status.HTTP_202_ACCEPTED)
def trigger_backup(
    req: BackupJobCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    server = db.query(Server).filter(Server.id == req.server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Servidor no encontrado.")

    drive_account = db.query(GoogleDriveAccount).filter(GoogleDriveAccount.is_active == True).first()
    if not drive_account or not drive_account.encrypted_token_json:
        raise HTTPException(
            status_code=400,
            detail="Google Drive no está conectado. Debe autorizar una cuenta de Google Drive antes de crear backups."
        )

    import json
    job = BackupJob(
        server_id=req.server_id,
        user_id=user.id,
        trigger_type="MANUAL",
        status="PENDING",
        progress_percent=0,
        current_step="Encolando tarea de backup...",
        target_database_ids=json.dumps(req.database_ids) if req.database_ids else None
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    # Dispatch to Celery worker, with fallback to background thread if Celery is offline
    try:
        from app.workers.tasks import run_backup_job
        run_backup_job.delay(job.id)
    except Exception:
        # Fallback to local thread execution for environments without running Celery
        from app.workers.tasks import execute_backup_job_logic
        t = threading.Thread(target=execute_backup_job_logic, args=(job.id,))
        t.daemon = True
        t.start()

    log_audit(
        db, action="TRIGGER_MANUAL_BACKUP",
        user=user,
        resource_type="BACKUP_JOB",
        resource_id=job.id,
        ip_address=get_client_ip(request),
        details={"server": server.name, "database_ids": req.database_ids}
    )

    return _format_job(job)

@router.get("", response_model=List[BackupJobResponse])
def list_backups(
    server_id: Optional[int] = None,
    status_filter: Optional[str] = None,
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    query = db.query(BackupJob)
    if server_id:
        query = query.filter(BackupJob.server_id == server_id)
    if status_filter:
        query = query.filter(BackupJob.status == status_filter.upper())
    
    jobs = query.order_by(BackupJob.id.desc()).offset(skip).limit(limit).all()
    return [_format_job(j) for j in jobs]

def _format_restore_job(r: RestoreJob) -> RestoreJobResponse:
    return RestoreJobResponse(
        id=r.id,
        backup_file_id=r.backup_file_id,
        file_name=r.backup_file.file_name if r.backup_file else "Desconocido",
        source_database_name=r.backup_file.database.name if (r.backup_file and r.backup_file.database) else None,
        target_server_id=r.target_server_id,
        target_server_name=r.target_server.name if r.target_server else "Desconocido",
        target_database_name=r.target_database_name,
        status=r.status,
        progress_percent=r.progress_percent,
        current_step=r.current_step,
        error_message=r.error_message,
        overwrite=r.overwrite,
        started_at=r.started_at,
        finished_at=r.finished_at,
        created_at=r.created_at
    )

@router.post("/files/{file_id}/restore", response_model=RestoreJobResponse, status_code=status.HTTP_202_ACCEPTED)
def trigger_restore(
    file_id: int,
    req: RestoreRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    backup_file = db.query(BackupFile).filter(BackupFile.id == file_id).first()
    if not backup_file:
        raise HTTPException(status_code=404, detail="Archivo de respaldo no encontrado.")

    if not backup_file.google_drive_file_id:
        raise HTTPException(status_code=400, detail="El archivo no cuenta con un ID válido en Google Drive.")

    target_server = db.query(Server).filter(Server.id == req.target_server_id).first()
    if not target_server:
        raise HTTPException(status_code=404, detail="Servidor destino no encontrado.")

    drive_account = db.query(GoogleDriveAccount).filter(GoogleDriveAccount.is_active == True).first()
    if not drive_account or not drive_account.encrypted_token_json:
        raise HTTPException(status_code=400, detail="Google Drive no está conectado.")

    restore_job = RestoreJob(
        backup_file_id=file_id,
        target_server_id=req.target_server_id,
        target_database_name=req.target_database_name.strip(),
        user_id=user.id,
        status="PENDING",
        progress_percent=0,
        current_step="Encolando tarea de restauración...",
        overwrite=req.overwrite
    )
    db.add(restore_job)
    db.commit()
    db.refresh(restore_job)

    # Launch background thread
    t = threading.Thread(target=RestoreEngine.run_database_restore, args=(restore_job.id,))
    t.daemon = True
    t.start()

    log_audit(
        db, action="TRIGGER_RESTORE",
        user=user,
        resource_type="RESTORE_JOB",
        resource_id=restore_job.id,
        ip_address=get_client_ip(request),
        details={
            "backup_file_id": file_id,
            "target_server": target_server.name,
            "target_database": req.target_database_name,
            "overwrite": req.overwrite
        }
    )

    return _format_restore_job(restore_job)

@router.get("/restores", response_model=List[RestoreJobResponse])
def list_restore_jobs(
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    jobs = db.query(RestoreJob).order_by(RestoreJob.id.desc()).offset(skip).limit(limit).all()
    return [_format_restore_job(j) for j in jobs]

@router.get("/restores/{restore_id}", response_model=RestoreJobResponse)
def get_restore_job(
    restore_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    job = db.query(RestoreJob).filter(RestoreJob.id == restore_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Tarea de restauración no encontrada.")
    return _format_restore_job(job)

@router.get("/{job_id}", response_model=BackupJobResponse)
def get_backup_job(
    job_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    job = db.query(BackupJob).filter(BackupJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job de backup no encontrado.")
    return _format_job(job)

@router.post("/{job_id}/resume", response_model=BackupJobResponse)
def resume_backup_job(
    job_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    job = db.query(BackupJob).filter(BackupJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job de backup no encontrado.")

    if job.status not in ["INTERRUPTED", "FAILED", "RUNNING", "PENDING"]:
        raise HTTPException(
            status_code=400,
            detail=f"Solo se pueden reanudar tareas interrumpidas o fallidas (Estado actual: {job.status})."
        )

    job.status = "PENDING"
    job.error_message = None
    job.current_step = "Reanudando tarea de backup..."
    db.commit()
    db.refresh(job)

    # Dispatch to background thread
    from app.workers.tasks import execute_backup_job_logic
    t = threading.Thread(target=execute_backup_job_logic, args=(job.id,))
    t.daemon = True
    t.start()

    log_audit(
        db, action="RESUME_BACKUP_JOB",
        user=user,
        resource_type="BACKUP_JOB",
        resource_id=job.id,
        ip_address=get_client_ip(request),
        details={"server": job.server.name if job.server else None}
    )

    return _format_job(job)


@router.get("/{job_id}/progress", response_model=BackupProgressResponse)
def get_backup_progress(
    job_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    job = db.query(BackupJob).filter(BackupJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job de backup no encontrado.")

    total_dbs = len(job.server.databases) if job.server else 1
    completed_files = len(job.backup_files)

    return BackupProgressResponse(
        job_id=job.id,
        status=job.status,
        progress_percent=job.progress_percent,
        current_step=job.current_step,
        current_database=None,
        processed_databases=completed_files,
        total_databases=max(total_dbs, completed_files),
        processed_bytes=job.total_compressed_size_bytes or 0,
        total_bytes=job.total_original_size_bytes or 0
    )

@router.delete("/{job_id}")
def delete_backup_job(
    job_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    job = db.query(BackupJob).filter(BackupJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job de backup no encontrado.")

    # Delete related files in Google Drive
    drive_account = db.query(GoogleDriveAccount).filter(GoogleDriveAccount.is_active == True).first()
    if drive_account and drive_account.encrypted_token_json:
        from app.core.security import decrypt_secret
        from app.services.google_drive_service import GoogleDriveService
        token_json = decrypt_secret(drive_account.encrypted_token_json)
        if token_json:
            for bf in job.backup_files:
                if bf.google_drive_file_id:
                    GoogleDriveService.delete_file(token_json, bf.google_drive_file_id)

    db.delete(job)
    db.commit()

    log_audit(
        db, action="DELETE_BACKUP_JOB",
        user=user,
        resource_type="BACKUP_JOB",
        resource_id=job_id,
        ip_address=get_client_ip(request)
    )

    return {"message": "Job de backup y archivos asociados eliminados correctamente."}


