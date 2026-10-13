import json
import logging
from typing import Optional, Any
from sqlalchemy.orm import Session
from app.models import AuditLog, User

logger = logging.getLogger(__name__)

def log_audit(
    db: Session,
    action: str,
    user: Optional[User] = None,
    user_email: Optional[str] = None,
    resource_type: Optional[str] = None,
    resource_id: Optional[str] = None,
    ip_address: Optional[str] = None,
    status: str = "SUCCESS",
    details: Optional[Any] = None
) -> None:
    try:
        details_str = None
        if details is not None:
            if isinstance(details, (dict, list)):
                details_str = json.dumps(details, default=str)
            else:
                details_str = str(details)

        email = user.email if user else user_email
        uid = user.id if user else None

        audit_entry = AuditLog(
            user_id=uid,
            user_email=email,
            action=action,
            resource_type=resource_type,
            resource_id=str(resource_id) if resource_id else None,
            ip_address=ip_address,
            status=status,
            details_json=details_str
        )
        db.add(audit_entry)
        db.commit()
    except Exception as e:
        logger.error(f"Error escribiendo registro de auditoría: {e}")
        db.rollback()
