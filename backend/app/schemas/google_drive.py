from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel

class GoogleDriveStatusResponse(BaseModel):
    is_connected: bool
    email: Optional[str] = None
    root_folder_id: Optional[str] = None
    root_folder_name: str = "BACKUPS"
    last_synced_at: Optional[datetime] = None

class GoogleDriveStorageResponse(BaseModel):
    total_bytes: Optional[int] = None
    used_bytes: Optional[int] = None
    available_bytes: Optional[int] = None
    total_formatted: Optional[str] = None
    used_formatted: Optional[str] = None
    available_formatted: Optional[str] = None
    is_unlimited: bool = False
    message: Optional[str] = None

class GoogleDriveFileItem(BaseModel):
    id: str
    name: str
    mime_type: str
    size_bytes: Optional[int] = None
    size_formatted: Optional[str] = None
    modified_time: Optional[str] = None
