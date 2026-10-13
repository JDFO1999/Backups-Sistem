from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel

class BranchResponse(BaseModel):
    id: int
    code: str
    name: str
    ip_address: str
    unc_path: str
    is_active: bool
    is_online: bool
    last_checked_at: Optional[datetime] = None
    last_backup_at: Optional[datetime] = None
    last_backup_size_bytes: Optional[int] = 0

    class Config:
        from_attributes = True

class BranchSyncResponse(BaseModel):
    total: int
    created: int
    updated: int
    online_count: int

class FolderBackupCreate(BaseModel):
    job_name: Optional[str] = None
    branch_ids: Optional[List[int]] = None
    subfolders: Optional[List[str]] = None

class FolderBackupFileResponse(BaseModel):
    id: int
    job_id: int
    branch_id: int
    branch_code: Optional[str] = None
    branch_name: Optional[str] = None
    file_name: str
    file_size_bytes: int
    raw_size_bytes: int
    sha256_checksum: Optional[str] = None
    google_drive_file_id: Optional[str] = None
    google_drive_path: Optional[str] = None
    subfolders_included: Optional[str] = None
    status: str
    created_at: datetime

    class Config:
        from_attributes = True

class FolderBackupJobResponse(BaseModel):
    id: int
    job_name: str
    status: str
    progress_percent: int
    current_step: str
    error_message: Optional[str] = None
    total_branches: int
    completed_branches: int
    total_size_bytes: int
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    created_at: datetime
    backup_files: Optional[List[FolderBackupFileResponse]] = []

    class Config:
        from_attributes = True
