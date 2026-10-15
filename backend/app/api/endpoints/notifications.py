from typing import Any, Dict
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_active_admin
from app.core.security import encrypt_secret, decrypt_secret
from app.models import NotificationConfig, User
from app.schemas.notification import (
    NotificationConfigResponse,
    NotificationConfigUpdate,
    TestNotificationRequest
)
from app.services.alert_service import AlertService, normalize_telegram_chat_id

router = APIRouter()


def _mask_secret(val: str, prefix_len: int = 4, suffix_len: int = 3) -> str:
    if not val:
        return ""
    if len(val) <= prefix_len + suffix_len:
        return "****"
    return f"{val[:prefix_len]}...{val[-suffix_len:]}"

def _build_response(cfg: NotificationConfig) -> NotificationConfigResponse:
    # Decrypt secrets for mask/status check
    tg_token = decrypt_secret(cfg.telegram_bot_token_encrypted)
    email_pwd = decrypt_secret(cfg.email_password_encrypted)
    wa_token = decrypt_secret(cfg.whatsapp_auth_token_encrypted)

    return NotificationConfigResponse(
        id=cfg.id,
        provider=cfg.provider or "TELEGRAM",
        is_enabled=cfg.is_enabled,
        telegram_bot_token_masked=_mask_secret(tg_token, 6, 4) if tg_token else None,
        telegram_chat_id=cfg.telegram_chat_id,
        telegram_configured=bool(tg_token and cfg.telegram_chat_id),
        email_smtp_host=cfg.email_smtp_host,
        email_smtp_port=cfg.email_smtp_port or 587,
        email_sender=cfg.email_sender,
        email_recipients=cfg.email_recipients,
        email_password_configured=bool(email_pwd),
        email_use_tls=cfg.email_use_tls,
        whatsapp_account_sid_masked=_mask_secret(cfg.whatsapp_account_sid, 6, 4) if cfg.whatsapp_account_sid else None,
        whatsapp_auth_token_configured=bool(wa_token),
        whatsapp_from=cfg.whatsapp_from,
        whatsapp_to=cfg.whatsapp_to,
        notify_on_start=cfg.notify_on_start,
        notify_on_success=cfg.notify_on_success,
        notify_on_error=cfg.notify_on_error,
        updated_at=cfg.updated_at
    )

@router.get("/config", response_model=NotificationConfigResponse)
def get_notification_config(
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_active_admin)
):
    """Retrieve current notification settings."""
    cfg = db.query(NotificationConfig).first()
    if not cfg:
        # Create default config with TELEGRAM enabled
        cfg = NotificationConfig(
            provider="TELEGRAM",
            is_enabled=True,
            notify_on_start=False,
            notify_on_success=True,
            notify_on_error=True
        )
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
    return _build_response(cfg)

@router.post("/config", response_model=NotificationConfigResponse)
def save_notification_config(
    payload: NotificationConfigUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_active_admin)
):
    """Save or update notification settings."""
    cfg = db.query(NotificationConfig).first()
    if not cfg:
        cfg = NotificationConfig()
        db.add(cfg)

    cfg.provider = payload.provider.upper() if payload.provider else "TELEGRAM"
    cfg.is_enabled = payload.is_enabled
    cfg.notify_on_start = payload.notify_on_start
    cfg.notify_on_success = payload.notify_on_success
    cfg.notify_on_error = payload.notify_on_error

    # Telegram
    if payload.telegram_bot_token and "..." not in payload.telegram_bot_token:
        cfg.telegram_bot_token_encrypted = encrypt_secret(payload.telegram_bot_token.strip())
    if payload.telegram_chat_id is not None:
        cfg.telegram_chat_id = normalize_telegram_chat_id(payload.telegram_chat_id)


    # Email
    cfg.email_smtp_host = payload.email_smtp_host.strip() if payload.email_smtp_host else None
    cfg.email_smtp_port = payload.email_smtp_port or 587
    cfg.email_sender = payload.email_sender.strip() if payload.email_sender else None
    cfg.email_recipients = payload.email_recipients.strip() if payload.email_recipients else None
    cfg.email_use_tls = payload.email_use_tls
    if payload.email_password and "..." not in payload.email_password:
        cfg.email_password_encrypted = encrypt_secret(payload.email_password.strip())

    # WhatsApp
    if payload.whatsapp_account_sid and "..." not in payload.whatsapp_account_sid:
        cfg.whatsapp_account_sid = payload.whatsapp_account_sid.strip()
    if payload.whatsapp_auth_token and "..." not in payload.whatsapp_auth_token:
        cfg.whatsapp_auth_token_encrypted = encrypt_secret(payload.whatsapp_auth_token.strip())
    if payload.whatsapp_from:
        cfg.whatsapp_from = payload.whatsapp_from.strip()
    if payload.whatsapp_to:
        cfg.whatsapp_to = payload.whatsapp_to.strip()

    db.commit()
    db.refresh(cfg)
    return _build_response(cfg)

@router.post("/test")
def test_notification(
    payload: TestNotificationRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_active_admin)
):
    """Send a live test message to verify the configuration."""
    cfg = db.query(NotificationConfig).first()
    target_provider = (payload.provider or (cfg.provider if cfg else "TELEGRAM")).upper()

    title = "Notificación de Prueba"
    message = "Esta es una alerta de prueba generada desde Alkosto Backup Manager para verificar la conectividad."
    details = {
        "Servicio": target_provider,
        "Estado": "CONECTADO",
        "Modo": "Direct Outbound HTTPS (Sin Webhooks)"
    }

    if target_provider == "TELEGRAM":
        token = payload.telegram_bot_token
        if not token or "..." in token:
            token = decrypt_secret(cfg.telegram_bot_token_encrypted) if cfg else None
        chat_id = payload.telegram_chat_id or (cfg.telegram_chat_id if cfg else None)

        if not token or not chat_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Falta el Bot Token o el Chat ID / Canal de Telegram."
            )

        success, msg = AlertService.send_telegram(
            token=token,
            chat_id=chat_id,
            title=title,
            message=message,
            severity="SUCCESS",
            details=details
        )
        return {"ok": success, "message": msg}

    elif target_provider == "EMAIL":
        host = payload.email_smtp_host or (cfg.email_smtp_host if cfg else None)
        port = payload.email_smtp_port or (cfg.email_smtp_port if cfg else 587)
        sender = payload.email_sender or (cfg.email_sender if cfg else None)
        recipients = payload.email_recipients or (cfg.email_recipients if cfg else None)
        password = payload.email_password
        if not password or "..." in password:
            password = decrypt_secret(cfg.email_password_encrypted) if cfg else None

        if not host or not sender or not recipients:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Configuración SMTP incompleta (Host, Remitente o Destinatarios)."
            )

        success, msg = AlertService.send_email(
            smtp_host=host,
            smtp_port=port,
            sender=sender,
            recipients=recipients,
            password=password or "",
            use_tls=True,
            title=title,
            message=message,
            severity="SUCCESS",
            details=details
        )
        return {"ok": success, "message": msg}

    elif target_provider == "WHATSAPP":
        sid = payload.whatsapp_account_sid or (cfg.whatsapp_account_sid if cfg else None)
        token = payload.whatsapp_auth_token
        if not token or "..." in token:
            token = decrypt_secret(cfg.whatsapp_auth_token_encrypted) if cfg else None
        from_num = payload.whatsapp_from or (cfg.whatsapp_from if cfg else None)
        to_num = payload.whatsapp_to or (cfg.whatsapp_to if cfg else None)

        if not sid or not token or not from_num or not to_num:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Configuración de Twilio WhatsApp incompleta."
            )

        success, msg = AlertService.send_whatsapp(
            account_sid=sid,
            auth_token=token,
            from_num=from_num,
            to_num=to_num,
            title=title,
            message=message,
            details=details
        )
        return {"ok": success, "message": msg}

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=f"Proveedor no soportado: {target_provider}"
    )
