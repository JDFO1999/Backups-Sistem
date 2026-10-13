from typing import List, Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.deps import get_current_active_admin
from app.models import AuditLog, User
from app.schemas.audit import AuditLogResponse

router = APIRouter()

@router.get("", response_model=List[AuditLogResponse])
def get_audit_logs(
    action: Optional[str] = None,
    status: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_active_admin)
):
    query = db.query(AuditLog)
    if action:
        query = query.filter(AuditLog.action == action.upper())
    if status:
        query = query.filter(AuditLog.status == status.upper())

    logs = query.order_by(AuditLog.id.desc()).offset(skip).limit(limit).all()
    return logs
