from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel
from app.schemas.backup import BackupJobResponse
from app.schemas.audit import AuditLogResponse

class StorageChartItem(BaseModel):
    date: str
    size_bytes: int
    size_formatted: str

class BackupsPerDayItem(BaseModel):
    date: str
    count: int

class DashboardStatsResponse(BaseModel):
    total_servers: int
    total_databases: int
    total_backups: int
    successful_backups: int
    failed_backups: int
    total_db_backups: int = 0
    total_folder_backups: int = 0
    total_branches: int = 0
    drive_used_bytes: int
    drive_used_formatted: str
    drive_available_bytes: Optional[int] = None
    drive_available_formatted: Optional[str] = None
    last_backup_time: Optional[datetime] = None
    next_scheduled_backup_time: Optional[datetime] = None
    recent_backups: List[BackupJobResponse] = []
    recent_errors: List[AuditLogResponse] = []
    storage_history: List[StorageChartItem] = []
    backups_per_day: List[BackupsPerDayItem] = []
