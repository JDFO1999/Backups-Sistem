from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel

class BackupJobCreate(BaseModel):
    server_id: int
    database_ids: List[int]
    compression_type: str = "GZIP"

class BackupFileResponse(BaseModel):
    id: int
    database_id: int
    database_name: Optional[str] = None
    file_name: str
    file_size_bytes: int
    file_size_formatted: Optional[str] = None
    original_db_size_bytes: int
    original_size_formatted: Optional[str] = None
    sha256_checksum: Optional[str] = None
    compression_algorithm: str
    google_drive_file_id: Optional[str] = None
    google_drive_path: Optional[str] = None
    status: str
    created_at: datetime

    class Config:
        from_attributes = True

class BackupJobResponse(BaseModel):
    id: int
    server_id: int
    server_name: Optional[str] = None
    trigger_type: str
    status: str
    progress_percent: int
    current_step: str
    error_message: Optional[str] = None
    total_original_size_bytes: int
    total_compressed_size_bytes: int
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    created_at: datetime
    files: List[BackupFileResponse] = []

    class Config:
        from_attributes = True

class BackupProgressResponse(BaseModel):
    job_id: int
    status: str
    progress_percent: int
    current_step: str
    current_database: Optional[str] = None
    processed_databases: int
    total_databases: int
    processed_bytes: int
    total_bytes: int
    speed_mb_s: Optional[float] = None
