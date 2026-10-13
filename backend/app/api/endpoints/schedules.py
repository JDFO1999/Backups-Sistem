from typing import List
from datetime import datetime, timezone
from croniter import croniter
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.deps import get_current_user, get_client_ip
from app.models import BackupSchedule, Server, Database, User
from app.schemas.schedule import (
    BackupScheduleCreate, BackupScheduleUpdate, BackupScheduleResponse
)
from app.services.audit_service import log_audit

router = APIRouter()

def _format_schedule(s: BackupSchedule) -> BackupScheduleResponse:
    db_ids = [d.id for d in s.databases] if s.databases else []
    return BackupScheduleResponse(
        id=s.id,
        name=s.name,
        server_id=s.server_id,
        server_name=s.server.name if s.server else "Desconocido",
        database_ids=db_ids,
        cron_expression=s.cron_expression,
        compression_type=s.compression_type,
        retention_count=s.retention_count,
        retention_days=s.retention_days,
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
    # Validate cron expression
    now = datetime.now(timezone.utc)
    try:
        c = croniter(sched_in.cron_expression, now)
        next_run = c.get_next(datetime)
    except Exception:
        raise HTTPException(
            status_code=400,
            detail=f"Expresión cron inválida '{sched_in.cron_expression}'. Ejemplo válido: '0 2 * * *' (todos los días a las 2 AM)."
        )

    server = db.query(Server).filter(Server.id == sched_in.server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Servidor no encontrado.")

    databases = db.query(Database).filter(Database.id.in_(sched_in.database_ids)).all()

    sched = BackupSchedule(
        name=sched_in.name,
        server_id=sched_in.server_id,
        cron_expression=sched_in.cron_expression,
        compression_type=sched_in.compression_type or "GZIP",
        retention_count=sched_in.retention_count,
        retention_days=sched_in.retention_days,
        is_active=sched_in.is_active,
        next_run_at=next_run
    )
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
        details={"name": sched.name, "cron": sched.cron_expression}
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
    if sched_in.cron_expression:
        now = datetime.now(timezone.utc)
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
