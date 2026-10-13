from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models import (
    Server, Database, BackupJob, BackupFile, BackupSchedule, GoogleDriveAccount, AuditLog, User
)
from app.schemas.dashboard import (
    DashboardStatsResponse, StorageChartItem, BackupsPerDayItem
)
from app.schemas.backup import BackupJobResponse
from app.schemas.audit import AuditLogResponse
from app.api.endpoints.backups import _format_job
from app.utils.formatters import format_bytes

router = APIRouter()

@router.get("", response_model=DashboardStatsResponse)
def get_dashboard_stats(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    total_servers = db.query(Server).count()
    total_databases = db.query(Database).count()
    total_backups = db.query(BackupJob).count()
    successful_backups = db.query(BackupJob).filter(BackupJob.status == "COMPLETED").count()
    failed_backups = db.query(BackupJob).filter(BackupJob.status == "FAILED").count()

    drive_account = db.query(GoogleDriveAccount).filter(GoogleDriveAccount.is_active == True).first()
    drive_used_bytes = drive_account.storage_used_bytes or 0 if drive_account else 0
    drive_total_bytes = drive_account.storage_total_bytes if drive_account else None
    drive_avail_bytes = (drive_total_bytes - drive_used_bytes) if drive_total_bytes else None

    # Last backup
    last_job = db.query(BackupJob).order_by(BackupJob.id.desc()).first()
    last_backup_time = last_job.finished_at if (last_job and last_job.finished_at) else None

    # Next scheduled backup
    next_sched = db.query(BackupSchedule).filter(
        BackupSchedule.is_active == True,
        BackupSchedule.next_run_at != None
    ).order_by(BackupSchedule.next_run_at.asc()).first()
    next_scheduled_time = next_sched.next_run_at if next_sched else None

    # Recent backups (last 5)
    recent_jobs = db.query(BackupJob).order_by(BackupJob.id.desc()).limit(5).all()

    # Recent errors (from AuditLog)
    recent_errors = db.query(AuditLog).filter(AuditLog.status == "FAILURE").order_by(AuditLog.id.desc()).limit(5).all()

    # Backups per day (last 7 days)
    now = datetime.now(timezone.utc)
    backups_per_day = []
    for i in range(6, -1, -1):
        day_date = (now - timedelta(days=i)).date()
        start = datetime(day_date.year, day_date.month, day_date.day, 0, 0, 0, tzinfo=timezone.utc)
        end = start + timedelta(days=1)
        cnt = db.query(BackupJob).filter(BackupJob.created_at >= start, BackupJob.created_at < end).count()
        backups_per_day.append(BackupsPerDayItem(date=day_date.strftime("%Y-%m-%d"), count=cnt))

    # Storage history chart
    storage_history = []
    # Sum files size grouped roughly
    files = db.query(BackupFile).filter(BackupFile.status == "COMPLETED").order_by(BackupFile.created_at.asc()).all()
    cumulative = 0
    for f in files[-10:]:
        cumulative += (f.file_size_bytes or 0)
        dt_str = f.created_at.strftime("%Y-%m-%d %H:%M") if f.created_at else "Hoy"
        storage_history.append(StorageChartItem(
            date=dt_str,
            size_bytes=cumulative,
            size_formatted=format_bytes(cumulative)
        ))

    return DashboardStatsResponse(
        total_servers=total_servers,
        total_databases=total_databases,
        total_backups=total_backups,
        successful_backups=successful_backups,
        failed_backups=failed_backups,
        drive_used_bytes=drive_used_bytes,
        drive_used_formatted=format_bytes(drive_used_bytes),
        drive_available_bytes=drive_avail_bytes,
        drive_available_formatted=format_bytes(drive_avail_bytes) if drive_avail_bytes is not None else "Ilimitado",
        last_backup_time=last_backup_time,
        next_scheduled_backup_time=next_scheduled_time,
        recent_backups=[_format_job(j) for j in recent_jobs],
        recent_errors=recent_errors,
        storage_history=storage_history,
        backups_per_day=backups_per_day
    )
