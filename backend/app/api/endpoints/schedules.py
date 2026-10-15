import json
from typing import List, Optional
from datetime import datetime, timezone
from croniter import croniter
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.deps import get_current_user, get_client_ip
from app.models import BackupSchedule, Server, Database, User, Branch
from app.schemas.schedule import (
    BackupScheduleCreate, BackupScheduleUpdate, BackupScheduleResponse
)
from app.services.audit_service import log_audit

router = APIRouter()

def _format_schedule(s: BackupSchedule) -> BackupScheduleResponse:
    db_ids = [d.id for d in s.databases] if s.databases else []
    target_branch_ids = []
    if s.target_branch_ids:
        try:
            target_branch_ids = json.loads(s.target_branch_ids)
        except Exception:
            pass

    target_subfolders = None
    if s.target_subfolders:
        try:
            target_subfolders = json.loads(s.target_subfolders)
        except Exception:
            pass

    server_name = None
    if s.server:
        server_name = s.server.name
    elif s.schedule_type == "FOLDER":
        server_name = "Carpetas de Tiendas"
    else:
        server_name = "N/A"

    return BackupScheduleResponse(
        id=s.id,
        name=s.name,
        schedule_type=s.schedule_type or "DATABASE",
        server_id=s.server_id,
        server_name=server_name,
        database_ids=db_ids,
        target_branch_ids=target_branch_ids,
        folder_scope=s.folder_scope or "critical",
        target_subfolders=target_subfolders,
        cron_expression=s.cron_expression,
        compression_type=s.compression_type or "GZIP",
        retention_count=s.retention_count or 7,
        retention_days=s.retention_days or 30,
        is_active=s.is_active,
        last_run_at=s.last_run_at,
        next_run_at=s.next_run_at,
        created_at=s.created_at,
        updated_at=s.updated_at
    )

@router.get("", response_model=List[BackupScheduleResponse])
def list_schedules(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    items = db.query(BackupSchedule).order_by(BackupSchedule.id.desc()).all()
    return [_format_schedule(s) for s in items]

@router.post("", response_model=BackupScheduleResponse, status_code=status.HTTP_201_CREATED)
def create_schedule(
    sched_in: BackupScheduleCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    # Validate cron expression using local system time
    now = datetime.now()
    try:
        c = croniter(sched_in.cron_expression, now)
        next_run = c.get_next(datetime)
    except Exception:
        raise HTTPException(
            status_code=400,
            detail=f"Expresión cron inválida '{sched_in.cron_expression}'. Ejemplo: '0 2 * * *' (diario 2 AM) o '0 */4 * * *' (cada 4 horas)."
        )

    schedule_type = sched_in.schedule_type or "DATABASE"
    server = None
    databases = []

    if schedule_type == "DATABASE":
        if not sched_in.server_id:
            raise HTTPException(status_code=400, detail="Debe seleccionar un servidor para respaldos de Base de Datos BC.")
        server = db.query(Server).filter(Server.id == sched_in.server_id).first()
        if not server:
            raise HTTPException(status_code=404, detail="Servidor no encontrado.")
        if sched_in.database_ids:
            databases = db.query(Database).filter(Database.id.in_(sched_in.database_ids)).all()
    else:
        # FOLDER schedule
        if not sched_in.target_branch_ids:
            all_b = db.query(Branch).filter(Branch.is_active == True).all()
            target_branch_ids = [b.id for b in all_b]
        else:
            target_branch_ids = sched_in.target_branch_ids

    target_branch_ids_json = json.dumps(sched_in.target_branch_ids) if sched_in.target_branch_ids else None
    target_subfolders_json = json.dumps(sched_in.target_subfolders) if sched_in.target_subfolders else None

    sched = BackupSchedule(
        name=sched_in.name,
        schedule_type=schedule_type,
        server_id=sched_in.server_id if schedule_type == "DATABASE" else None,
        target_branch_ids=target_branch_ids_json,
        target_subfolders=target_subfolders_json,
        folder_scope=sched_in.folder_scope or "critical",
        cron_expression=sched_in.cron_expression,
        compression_type=sched_in.compression_type or "GZIP",
        retention_count=sched_in.retention_count,
        retention_days=sched_in.retention_days,
        is_active=sched_in.is_active,
        next_run_at=next_run
    )
    if databases:
        sched.databases = databases

    db.add(sched)
    db.commit()
    db.refresh(sched)

    log_audit(
        db, action="CREATE_SCHEDULE",
        user=user,
        resource_type="SCHEDULE",
        resource_id=sched.id,
        ip_address=get_client_ip(request),
        details={"name": sched.name, "type": schedule_type, "cron": sched.cron_expression}
    )

    return _format_schedule(sched)

@router.put("/{sched_id}", response_model=BackupScheduleResponse)
def update_schedule(
    sched_id: int,
    sched_in: BackupScheduleUpdate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    sched = db.query(BackupSchedule).filter(BackupSchedule.id == sched_id).first()
    if not sched:
        raise HTTPException(status_code=404, detail="Programación no encontrada.")

    if sched_in.name:
        sched.name = sched_in.name
    if sched_in.schedule_type:
        sched.schedule_type = sched_in.schedule_type
    if sched_in.server_id is not None:
        sched.server_id = sched_in.server_id
    if sched_in.folder_scope is not None:
        sched.folder_scope = sched_in.folder_scope
    if sched_in.target_branch_ids is not None:
        sched.target_branch_ids = json.dumps(sched_in.target_branch_ids)
    if sched_in.target_subfolders is not None:
        sched.target_subfolders = json.dumps(sched_in.target_subfolders)

    if sched_in.cron_expression:
        now = datetime.now()
        try:
            c = croniter(sched_in.cron_expression, now)
            sched.next_run_at = c.get_next(datetime)
            sched.cron_expression = sched_in.cron_expression
        except Exception:
            raise HTTPException(status_code=400, detail="Expresión cron inválida.")

    if sched_in.compression_type:
        sched.compression_type = sched_in.compression_type
    if sched_in.retention_count is not None:
        sched.retention_count = sched_in.retention_count
    if sched_in.retention_days is not None:
        sched.retention_days = sched_in.retention_days
    if sched_in.is_active is not None:
        sched.is_active = sched_in.is_active
    if sched_in.database_ids is not None:
        databases = db.query(Database).filter(Database.id.in_(sched_in.database_ids)).all()
        sched.databases = databases

    db.commit()
    db.refresh(sched)

    log_audit(
        db, action="UPDATE_SCHEDULE",
        user=user,
        resource_type="SCHEDULE",
        resource_id=sched.id,
        ip_address=get_client_ip(request),
        details={"name": sched.name}
    )

    return _format_schedule(sched)

@router.post("/{sched_id}/trigger")
def trigger_schedule_now(
    sched_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    sched = db.query(BackupSchedule).filter(BackupSchedule.id == sched_id).first()
    if not sched:
        raise HTTPException(status_code=404, detail="Programación no encontrada.")

    from app.workers.tasks import trigger_single_schedule
    job = trigger_single_schedule(db, sched, user_id=user.id)

    log_audit(
        db, action="TRIGGER_SCHEDULE_MANUAL",
        user=user,
        resource_type="SCHEDULE",
        resource_id=sched.id,
        ip_address=get_client_ip(request),
        details={"name": sched.name, "type": sched.schedule_type}
    )

    return {"message": f"Programación '{sched.name}' disparada con éxito.", "job_id": job.id if job else None}

@router.patch("/{sched_id}/toggle", response_model=BackupScheduleResponse)
def toggle_schedule_active(
    sched_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    sched = db.query(BackupSchedule).filter(BackupSchedule.id == sched_id).first()
    if not sched:
        raise HTTPException(status_code=404, detail="Programación no encontrada.")

    sched.is_active = not sched.is_active
    if sched.is_active:
        now = datetime.now()
        try:
            c = croniter(sched.cron_expression, now)
            sched.next_run_at = c.get_next(datetime)
        except Exception:
            pass

    db.commit()
    db.refresh(sched)

    return _format_schedule(sched)


@router.delete("/{sched_id}")
def delete_schedule(
    sched_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    sched = db.query(BackupSchedule).filter(BackupSchedule.id == sched_id).first()
    if not sched:
        raise HTTPException(status_code=404, detail="Programación no encontrada.")

    db.delete(sched)
    db.commit()

    log_audit(
        db, action="DELETE_SCHEDULE",
        user=user,
        resource_type="SCHEDULE",
        resource_id=sched_id,
        ip_address=get_client_ip(request)
    )

    return {"message": "Programación eliminada exitosamente."}
