from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field

class ServerBase(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    host: str
    ssh_port: int = Field(22, ge=1, le=65535)
    username: str
    auth_type: str = "KEY" # KEY or PASSWORD
    os_type: str = "LINUX" # LINUX or WINDOWS
    os_info: Optional[str] = "Linux"

class ServerCreate(ServerBase):
    ssh_key: Optional[str] = None
    password: Optional[str] = None

class ServerUpdate(BaseModel):
    name: Optional[str] = None
    host: Optional[str] = None
    ssh_port: Optional[int] = None
    username: Optional[str] = None
    auth_type: Optional[str] = None
    os_type: Optional[str] = None
    ssh_key: Optional[str] = None
    password: Optional[str] = None
    os_info: Optional[str] = None

class ServerResponse(ServerBase):
    id: int
    status: str
    last_contact_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    has_key: bool = False
    has_password: bool = False

    class Config:
        from_attributes = True

class ServerTestResult(BaseModel):
    success: bool
    latency_ms: Optional[float] = None
    os_detected: Optional[str] = None
    message: str
