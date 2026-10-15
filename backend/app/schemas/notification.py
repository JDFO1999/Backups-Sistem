from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field

class NotificationConfigBase(BaseModel):
    provider: str = Field('TELEGRAM', description="TELEGRAM, EMAIL or WHATSAPP")
    is_enabled: bool = True
    
    # Telegram
    telegram_bot_token: Optional[str] = None
    telegram_chat_id: Optional[str] = None

    # Email SMTP
    email_smtp_host: Optional[str] = None
    email_smtp_port: Optional[int] = 587
    email_sender: Optional[str] = None
    email_recipients: Optional[str] = None
    email_password: Optional[str] = None
    email_use_tls: bool = True

    # WhatsApp
    whatsapp_account_sid: Optional[str] = None
    whatsapp_auth_token: Optional[str] = None
    whatsapp_from: Optional[str] = None
    whatsapp_to: Optional[str] = None

    # Triggers
    notify_on_start: bool = False
    notify_on_success: bool = True
    notify_on_error: bool = True

class NotificationConfigCreate(NotificationConfigBase):
    pass

class NotificationConfigUpdate(NotificationConfigBase):
    pass

class NotificationConfigResponse(BaseModel):
    id: int
    provider: str
    is_enabled: bool

    # Masked token and chat id
    telegram_bot_token_masked: Optional[str] = None
    telegram_chat_id: Optional[str] = None
    telegram_configured: bool = False

    # Email
    email_smtp_host: Optional[str] = None
    email_smtp_port: Optional[int] = 587
    email_sender: Optional[str] = None
    email_recipients: Optional[str] = None
    email_password_configured: bool = False
    email_use_tls: bool = True

    # WhatsApp
    whatsapp_account_sid_masked: Optional[str] = None
    whatsapp_auth_token_configured: bool = False
    whatsapp_from: Optional[str] = None
    whatsapp_to: Optional[str] = None

    # Triggers
    notify_on_start: bool
    notify_on_success: bool
    notify_on_error: bool

    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class TestNotificationRequest(BaseModel):
    provider: Optional[str] = None
    telegram_bot_token: Optional[str] = None
    telegram_chat_id: Optional[str] = None
    email_smtp_host: Optional[str] = None
    email_smtp_port: Optional[int] = 587
    email_sender: Optional[str] = None
    email_recipients: Optional[str] = None
    email_password: Optional[str] = None
    whatsapp_account_sid: Optional[str] = None
    whatsapp_auth_token: Optional[str] = None
    whatsapp_from: Optional[str] = None
    whatsapp_to: Optional[str] = None
