from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_user, get_current_active_admin, get_client_ip
from app.core.security import encrypt_secret, decrypt_secret
from app.models import GoogleDriveAccount, User
from app.schemas.google_drive import (
    GoogleDriveStatusResponse, GoogleDriveStorageResponse
)
from app.services.google_drive_service import GoogleDriveService
from app.services.audit_service import log_audit
from app.utils.formatters import format_bytes
import logging

logger = logging.getLogger(__name__)

router = APIRouter()

@router.get("/status", response_model=GoogleDriveStatusResponse)
def get_drive_status(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    account = db.query(GoogleDriveAccount).filter(GoogleDriveAccount.is_active == True).first()
    if not account or not account.encrypted_token_json:
        return GoogleDriveStatusResponse(
            is_connected=False,
            email=None,
            root_folder_id=None,
            root_folder_name="BACKUPS",
            last_synced_at=None
        )

    # Validate whether refresh token is still alive
    try:
        from google.auth.exceptions import RefreshError
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import Request
        import json

        token_raw = decrypt_secret(account.encrypted_token_json)
        if not token_raw:
            return GoogleDriveStatusResponse(is_connected=False, email=account.email, root_folder_name="BACKUPS")
        token_data = json.loads(token_raw)
        creds = Credentials.from_authorized_user_info(token_data)
        if creds.expired or not creds.valid:
            creds.refresh(Request())
    except RefreshError as re:
        if "invalid_grant" in str(re).lower():
            logger.warning(f"Google Drive token revoked for {account.email}: {re}")
            return GoogleDriveStatusResponse(
                is_connected=False,
                email=account.email,
                root_folder_id=account.root_folder_id,
                root_folder_name=account.root_folder_name or "BACKUPS",
                last_synced_at=account.last_synced_at
            )
    except Exception as e:
        logger.warning(f"Error checking token validity: {e}")

    return GoogleDriveStatusResponse(
        is_connected=True,
        email=account.email,
        root_folder_id=account.root_folder_id,
        root_folder_name=account.root_folder_name or "BACKUPS",
        last_synced_at=account.last_synced_at
    )

@router.get("/accounts")
def list_drive_accounts(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    accounts = db.query(GoogleDriveAccount).order_by(GoogleDriveAccount.created_at.desc()).all()
    res = []
    for acc in accounts:
        res.append({
            "id": acc.id,
            "email": acc.email,
            "root_folder_id": acc.root_folder_id,
            "root_folder_name": acc.root_folder_name or "BACKUPS",
            "is_active": acc.is_active,
            "storage_total_bytes": acc.storage_total_bytes,
            "storage_used_bytes": acc.storage_used_bytes,
            "last_synced_at": acc.last_synced_at
        })
    return res

@router.post("/accounts/{account_id}/activate")
def activate_drive_account(
    account_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_active_admin)
):
    target = db.query(GoogleDriveAccount).filter(GoogleDriveAccount.id == account_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Cuenta de Google Drive no encontrada.")
    
    # Deactivate others, activate this one
    db.query(GoogleDriveAccount).update({GoogleDriveAccount.is_active: False})
    target.is_active = True
    db.commit()
    return {"message": f"Cuenta {target.email} activada como destino principal."}

@router.delete("/accounts/{account_id}")
def delete_drive_account(
    account_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_active_admin)
):
    target = db.query(GoogleDriveAccount).filter(GoogleDriveAccount.id == account_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada.")
    db.delete(target)
    # If it was active, activate the next available if any
    next_acc = db.query(GoogleDriveAccount).first()
    if next_acc:
        next_acc.is_active = True
    db.commit()
    return {"message": "Cuenta eliminada correctamente."}

@router.get("/auth")
def get_auth_url(
    admin: User = Depends(get_current_active_admin)
):
    if not settings.GOOGLE_CLIENT_ID or not settings.GOOGLE_CLIENT_SECRET:
        raise HTTPException(
            status_code=400,
            detail="Las credenciales de Google OAuth (GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET) no están configuradas en las variables de entorno."
        )
    auth_url, state = GoogleDriveService.get_auth_url()
    return {"auth_url": auth_url, "state": state}

@router.get("/callback")
def oauth_callback(
    code: str,
    db: Session = Depends(get_db)
):
    try:
        data = GoogleDriveService.exchange_code(code)
        token_json = data["token_json"]
        email = data["email"]

        # Encrypt tokens for DB storage
        enc_token = encrypt_secret(token_json)

        # Create or update default root folder in Google Drive
        root_id = GoogleDriveService.find_or_create_folder(token_json, "BACKUPS")

        # Deactivate previous accounts so this newly added account is active
        db.query(GoogleDriveAccount).update({GoogleDriveAccount.is_active: False})

        account = db.query(GoogleDriveAccount).filter(GoogleDriveAccount.email == email).first()
        if not account:
            account = GoogleDriveAccount(
                email=email,
                root_folder_id=root_id,
                root_folder_name="BACKUPS",
                encrypted_token_json=enc_token,
                is_active=True,
                last_synced_at=datetime.now(timezone.utc)
            )
            db.add(account)
        else:
            account.email = email
            account.root_folder_id = root_id
            account.root_folder_name = "BACKUPS"
            account.encrypted_token_json = enc_token
            account.is_active = True
            account.last_synced_at = datetime.now(timezone.utc)

        db.commit()

        # Redirect to frontend Google Drive settings page
        return RedirectResponse(url=f"{settings.APP_URL}/google-drive?connected=true")

    except Exception as e:
        return RedirectResponse(url=f"{settings.APP_URL}/google-drive?error={str(e)}")

@router.get("/storage", response_model=GoogleDriveStorageResponse)
def get_drive_storage(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    account = db.query(GoogleDriveAccount).filter(GoogleDriveAccount.is_active == True).first()
    if not account or not account.encrypted_token_json:
        raise HTTPException(status_code=400, detail="Google Drive no está conectado.")

    token_json = decrypt_secret(account.encrypted_token_json)
    if not token_json:
        raise HTTPException(status_code=400, detail="No se pudieron descifrar los tokens de Google Drive.")

    try:
        quota = GoogleDriveService.get_storage_quota(token_json)
        total = quota["total_bytes"]
        used = quota["used_bytes"]
        avail = quota["available_bytes"]

        account.storage_total_bytes = total
        account.storage_used_bytes = used
        account.last_synced_at = datetime.now(timezone.utc)
        db.commit()

        return GoogleDriveStorageResponse(
            total_bytes=total,
            used_bytes=used,
            available_bytes=avail,
            total_formatted=format_bytes(total) if total is not None else "Ilimitado",
            used_formatted=format_bytes(used),
            available_formatted=format_bytes(avail) if avail is not None else "Ilimitado",
            is_unlimited=quota["is_unlimited"],
            message="Almacenamiento consultado en tiempo real desde Google Drive API."
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error consultando Google Drive API: {str(e)}")

@router.post("/disconnect")
def disconnect_google_drive(
    request: Request,
    admin: User = Depends(get_current_active_admin),
    db: Session = Depends(get_db)
):
    account = db.query(GoogleDriveAccount).filter(GoogleDriveAccount.is_active == True).first()
    if account:
        account.is_active = False
        account.encrypted_token_json = None
        db.commit()

        log_audit(
            db, action="DISCONNECT_GOOGLE_DRIVE",
            user=admin,
            resource_type="GOOGLE_DRIVE",
            ip_address=get_client_ip(request),
            details={"email": account.email}
        )

    return {"message": "Cuenta de Google Drive desconectada exitosamente."}
