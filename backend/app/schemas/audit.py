from typing import Optional
from datetime import datetime
from pydantic import BaseModel

class AuditLogResponse(BaseModel):
    id: int
    user_id: Optional[int] = None
    user_email: Optional[str] = None
    action: str
    resource_type: Optional[str] = None
    resource_id: Optional[str] = None
    ip_address: Optional[str] = None
    status: str
    details_json: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True
