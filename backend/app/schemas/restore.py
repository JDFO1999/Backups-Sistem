from typing import Optional
from datetime import datetime
from pydantic import BaseModel

class RestoreRequest(BaseModel):
    target_server_id: int
    target_database_name: str
    overwrite: bool = False

class RestoreJobResponse(BaseModel):
    id: int
    backup_file_id: int
    file_name: str
    source_database_name: Optional[str] = None
    target_server_id: int
    target_server_name: Optional[str] = None
    target_database_name: str
    status: str
    progress_percent: int
    current_step: str
    error_message: Optional[str] = None
    overwrite: bool
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True
