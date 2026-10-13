from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel, Field

class BackupScheduleCreate(BaseModel):
    name: str
    server_id: int
    database_ids: List[int]
    cron_expression: str = Field(..., description="Expresión cron estándar de 5 campos (ej: '0 2 * * *')")
    compression_type: str = "GZIP"
    retention_count: int = Field(7, ge=1, le=365)
    retention_days: int = Field(30, ge=1, le=3650)
    is_active: bool = True

class BackupScheduleUpdate(BaseModel):
    name: Optional[str] = None
    database_ids: Optional[List[int]] = None
    cron_expression: Optional[str] = None
    compression_type: Optional[str] = None
    retention_count: Optional[int] = None
    retention_days: Optional[int] = None
    is_active: Optional[bool] = None

class BackupScheduleResponse(BaseModel):
    id: int
    name: str
    server_id: int
    server_name: Optional[str] = None
    database_ids: List[int] = []
    cron_expression: str
    compression_type: str
    retention_count: int
    retention_days: int
    is_active: bool
    last_run_at: Optional[datetime] = None
    next_run_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
