import json
import threading
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, get_client_ip
from app.models import User, Branch, FolderBackupJob, FolderBackupFile, GoogleDriveAccount
from app.schemas.folder_backup import (
    BranchResponse,
    BranchSyncResponse,
    FolderBackupCreate,
    FolderBackupJobResponse,
    FolderBackupFileResponse,
    FolderBackupStatsResponse
)
from app.services.branch_service import BranchService
from app.services.folder_backup_engine import execute_folder_backup_job_logic
from app.services.audit_service import log_audit

router = APIRouter()

def _format_folder_job(job: FolderBackupJob) -> FolderBackupJobResponse:
    files_res = []
    for f in (job.backup_files or []):
        files_res.append(FolderBackupFileResponse,
    FolderBackupStatsResponse(
            id=f.id,
            job_id=f.job_id,
            branch_id=f.branch_id,
            branch_code=f.branch.code if f.branch else "N/A",
            branch_name=f.branch.name if f.branch else "N/A",
            file_name=f.file_name,
            file_size_bytes=f.file_size_bytes or 0,
            raw_size_bytes=f.raw_size_bytes or 0,
            sha256_checksum=f.sha256_checksum,
            google_drive_file_id=f.google_drive_file_id,
            google_drive_path=f.google_drive_path,
            subfolders_included=f.subfolders_included,
            status=f.status,
            created_at=f.created_at
        ))
    return FolderBackupJobResponse(
        id=job.id,
        job_name=job.job_name,
        status=job.status,
        progress_percent=job.progress_percent,
        current_step=job.current_step,
        error_message=job.error_message,
        total_branches=job.total_branches or 0,
        completed_branches=job.completed_branches or 0,
        total_size_bytes=job.total_size_bytes or 0,
        started_at=job.started_at,
        finished_at=job.finished_at,
        created_at=job.created_at,
        backup_files=files_res
    )


@router.get("/stats", response_model=FolderBackupStatsResponse)
def get_folder_backup_stats(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Return aggregated stats of folder backups stored in Google Drive"""
    from sqlalchemy import func
    total_branches = db.query(Branch).count()
    online_branches = db.query(Branch).filter(Branch.is_online == True).count()
    total_jobs = db.query(FolderBackupJob).count()
    
    total_drive_bytes = db.query(func.coalesce(func.sum(FolderBackupFile.file_size_bytes), 0))\
        .filter(FolderBackupFile.status == 'COMPLETED').scalar() or 0
        
    total_raw_bytes = db.query(func.coalesce(func.sum(FolderBackupFile.raw_size_bytes), 0))\
        .filter(FolderBackupFile.status == 'COMPLETED').scalar() or 0
        
    return FolderBackupStatsResponse(
        total_branches=total_branches,
        online_branches=online_branches,
        total_jobs=total_jobs,
        total_drive_bytes=int(total_drive_bytes),
        total_raw_bytes=int(total_raw_bytes),
        disk_c_used_bytes=0,
        storage_mode="Zero-Disk RAM Streaming directo a Drive por Sucursal"
    )

@router.get("/branches", response_model=List[BranchResponse])
def list_branches(
    refresh: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Retrieve all synchronized branches with reachability status"""
    branches = BranchService.get_branches(db, refresh_online=refresh)
    return branches

@router.post("/branches/sync", response_model=BranchSyncResponse)
def sync_branches(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Sync branches from SQL Server Sistemas.dbo.Sucursal"""
    try:
        res = BranchService.sync_branches_from_sql_server(db)
        log_audit(
            db, action="SYNC_BRANCHES",
            user=user,
            resource_type="BRANCHES",
            resource_id="ALL",
            ip_address=get_client_ip(request),
            details=res
        )
        return res
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error sincronizando sucursales desde SQL Server: {str(e)}"
        )

@router.get("/branches/{branch_id}/subfolders", response_model=List[str])
def list_branch_subfolders(
    branch_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """List available top-level subfolders in branch share"""
    branch = db.query(Branch).filter(Branch.id == branch_id).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Sucursal no encontrada.")
    subfolders = BranchService.get_branch_subfolders(branch.unc_path)
    return [sf["name"] for sf in subfolders]

@router.post("/jobs", response_model=FolderBackupJobResponse, status_code=status.HTTP_202_ACCEPTED)
def trigger_folder_backup_job(
    req: FolderBackupCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Trigger a new folder backup job across selected or all branches"""
    drive_account = db.query(GoogleDriveAccount).filter(GoogleDriveAccount.is_active == True).first()
    if not drive_account or not drive_account.encrypted_token_json:
        raise HTTPException(status_code=400, detail="Google Drive no está conectado o autorizado.")

    target_branch_ids = req.branch_ids
    if not target_branch_ids:
        all_branches = db.query(Branch).filter(Branch.is_active == True).all()
        target_branch_ids = [b.id for b in all_branches]

    if not target_branch_ids:
        raise HTTPException(status_code=400, detail="No hay sucursales activas seleccionadas.")

    from datetime import datetime, timezone
    job_name = req.job_name or f"Respaldo Carpetas {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')}"

    job = FolderBackupJob(
        job_name=job_name,
        target_branch_ids=json.dumps(target_branch_ids),
        target_subfolders=json.dumps(req.subfolders) if req.subfolders else None,
        user_id=user.id,
        status="PENDING",
        progress_percent=0,
        current_step="Encolando tarea de respaldo de carpetas...",
        total_branches=len(target_branch_ids)
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    # Launch background thread
    t = threading.Thread(target=execute_folder_backup_job_logic, args=(job.id,))
    t.daemon = True
    t.start()

    log_audit(
        db, action="TRIGGER_FOLDER_BACKUP",
        user=user,
        resource_type="FOLDER_BACKUP_JOB",
        resource_id=job.id,
        ip_address=get_client_ip(request),
        details={"branches_count": len(target_branch_ids), "subfolders": req.subfolders}
    )

    return _format_folder_job(job)

@router.get("/jobs", response_model=List[FolderBackupJobResponse])
def list_folder_backup_jobs(
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    jobs = db.query(FolderBackupJob).order_by(FolderBackupJob.id.desc()).offset(skip).limit(limit).all()
    return [_format_folder_job(j) for j in jobs]

@router.get("/jobs/{job_id}", response_model=FolderBackupJobResponse)
def get_folder_backup_job(
    job_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    job = db.query(FolderBackupJob).filter(FolderBackupJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Tarea de respaldo de carpetas no encontrada.")
    return _format_folder_job(job)

@router.post("/jobs/{job_id}/resume", response_model=FolderBackupJobResponse)
def resume_folder_backup_job(
    job_id: int,
    restart_fresh: bool = False,
    request: Request = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    job = db.query(FolderBackupJob).filter(FolderBackupJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Tarea no encontrada.")

    drive_account = db.query(GoogleDriveAccount).filter(GoogleDriveAccount.is_active == True).first()
    token_json = None
    if drive_account and drive_account.encrypted_token_json:
        from app.core.security import decrypt_secret
        token_json = decrypt_secret(drive_account.encrypted_token_json)

    if restart_fresh:
        # Opción 2: Borrar archivos incompletos en Google Drive y resetear progreso
        if token_json:
            from app.services.google_drive_service import GoogleDriveService
            for bf in job.backup_files:
                if bf.google_drive_file_id:
                    try:
                        GoogleDriveService.delete_file(token_json, bf.google_drive_file_id)
                    except Exception as de:
                        logger.warning(f"Error borrando archivo {bf.file_name} en Drive: {de}")

            if job.target_branch_ids:
                try:
                    b_ids = json.loads(job.target_branch_ids)
                    branches = db.query(Branch).filter(Branch.id.in_(b_ids)).all()
                    for b in branches:
                        GoogleDriveService.clean_branch_folder_in_drive(token_json, drive_account.root_folder_name or "BACKUPS", b.code)
                except Exception as ce:
                    logger.warning(f"Error limpiando carpetas de sucursales en Drive: {ce}")

        # Limpiar registros locales de la tarea
        for bf in list(job.backup_files):
            db.delete(bf)

        job.completed_branches = 0
        job.total_size_bytes = 0
        job.progress_percent = 0
        job.current_step = "Reiniciando respaldo desde cero (incompletos eliminados de Drive)..."
    else:
        # Opción 1: Continuar por donde quedó (aprovechando checkpoints)
        job.current_step = "Reanudando tarea de respaldo desde el último punto de control..."

    job.status = "PENDING"
    job.error_message = None
    db.commit()
    db.refresh(job)

    t = threading.Thread(target=execute_folder_backup_job_logic, args=(job.id,))
    t.daemon = True
    t.start()

    log_audit(
        db, action="RESTART_FOLDER_BACKUP" if restart_fresh else "RESUME_FOLDER_BACKUP",
        user=user,
        resource_type="FOLDER_BACKUP_JOB",
        resource_id=job.id,
        ip_address=get_client_ip(request) if request else "127.0.0.1",
        details={"restart_fresh": restart_fresh}
    )

    return _format_folder_job(job)

@router.delete("/jobs/{job_id}")
def delete_folder_backup_job(
    job_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    job = db.query(FolderBackupJob).filter(FolderBackupJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Tarea no encontrada.")

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
        db, action="DELETE_FOLDER_BACKUP_JOB",
        user=user,
        resource_type="FOLDER_BACKUP_JOB",
        resource_id=job_id,
        ip_address=get_client_ip(request)
    )

    return {"message": "Tarea de respaldo de carpetas y archivos eliminados correctamente."}
