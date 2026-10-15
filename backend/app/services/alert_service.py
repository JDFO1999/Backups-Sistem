import json
import logging
import smtplib
import urllib.parse
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional, Dict, Any, Tuple
from urllib import request as urllib_request

from app.core.database import SessionLocal
from app.core.security import decrypt_secret
from app.models import NotificationConfig

logger = logging.getLogger(__name__)

def normalize_telegram_chat_id(chat_id: str) -> str:
    if not chat_id:
        return ""
    val = chat_id.strip()
    if "telegram.org" in val and "#" in val:
        val = val.split("#")[-1]
    if val.startswith("@"):
        return val
    if val.startswith("-100"):
        return val
    if val.startswith("-") and val[1:].isdigit():
        return f"-100{val[1:]}"
    if val.isdigit() and len(val) >= 9:
        return f"-100{val}"
    return val

class AlertService:
    @classmethod
    def get_config(cls, db=None) -> Optional[NotificationConfig]:
        """Fetch the active notification config from DB"""
        close_session = False
        if db is None:
            db = SessionLocal()
            close_session = True
        try:
            config = db.query(NotificationConfig).first()
            return config
        finally:
            if close_session:
                db.close()

    @classmethod
    def send_telegram(
        cls,
        token: str,
        chat_id: str,
        title: str,
        message: str,
        severity: str = "INFO",
        details: Optional[Dict[str, Any]] = None
    ) -> Tuple[bool, str]:
        """
        Sends an alert message directly to a Telegram Channel or Chat via Outbound HTTPS.
        No Webhook needed!
        """
        if not token or not chat_id:
            return False, "Token de Bot o Chat ID / Canal no especificado."

        clean_token = token.strip()
        clean_chat_id = normalize_telegram_chat_id(chat_id)


        # Emojis by severity
        severity_emojis = {
            "SUCCESS": "✅",
            "ERROR": "🚨",
            "WARNING": "⚠️",
            "INFO": "ℹ️",
            "START": "🚀"
        }
        emoji = severity_emojis.get(severity.upper(), "📢")

        # Build clean HTML message
        header_title = title if title.startswith("🚀") or title.startswith("✅") or title.startswith("🚨") or title.startswith("⚠️") or title.startswith("ℹ️") else f"{emoji} {title}"
        lines = [
            f"<b>{header_title}</b>",
            f"<i>{message}</i>",
            ""
        ]

        if details:
            lines.append("<b>Detalles del Respaldo:</b>")
            for k, v in details.items():
                lines.append(f"• <b>{k}:</b> <code>{v}</code>")
            lines.append("")

        lines.append("🏢 <b>Alkosto - Sistema de Gestión de Respaldos</b>")
        full_text = "\n".join(lines)

        url = f"https://api.telegram.org/bot{clean_token}/sendMessage"
        payload = {
            "chat_id": clean_chat_id,
            "text": full_text,
            "parse_mode": "HTML",
            "disable_web_page_preview": True
        }

        try:
            req = urllib_request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json", "User-Agent": "AlkostoBackupAlerts/1.0"},
                method="POST"
            )
            with urllib_request.urlopen(req, timeout=12) as resp:
                resp_data = json.loads(resp.read().decode("utf-8"))
                if resp_data.get("ok"):
                    return True, "Mensaje enviado exitosamente al canal/chat de Telegram."
                return False, resp_data.get("description", "Error desconocido de Telegram.")
        except Exception as e:
            err_str = str(e)
            logger.error(f"[ALERT_SERVICE] Error enviando a Telegram: {err_str}")
            return False, f"Fallo al conectar con Telegram: {err_str}"

    @classmethod
    def send_email(
        cls,
        smtp_host: str,
        smtp_port: int,
        sender: str,
        recipients: str,
        password: str,
        use_tls: bool,
        title: str,
        message: str,
        severity: str = "INFO",
        details: Optional[Dict[str, Any]] = None
    ) -> Tuple[bool, str]:
        """Sends an alert email via SMTP"""
        if not smtp_host or not sender or not recipients:
            return False, "Configuración SMTP incompleta (host, remitente o destinatarios)."

        to_list = [r.strip() for r in recipients.replace(";", ",").split(",") if r.strip()]
        if not to_list:
            return False, "No hay destinatarios de correo válidos."

        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"[{severity.upper()}] {title} - Alkosto Backup"
        msg["From"] = sender
        msg["To"] = ", ".join(to_list)

        text_content = f"{title}\n\n{message}\n\n"
        if details:
            for k, v in details.items():
                text_content += f"{k}: {v}\n"

        msg.attach(MIMEText(text_content, "plain"))

        try:
            server = smtplib.SMTP(smtp_host, smtp_port, timeout=10)
            if use_tls:
                server.starttls()
            if password:
                server.login(sender, password)
            server.sendmail(sender, to_list, msg.as_string())
            server.quit()
            return True, "Correo de alerta enviado exitosamente."
        except Exception as e:
            err_str = str(e)
            logger.error(f"[ALERT_SERVICE] Error enviando correo: {err_str}")
            return False, f"Fallo SMTP: {err_str}"

    @classmethod
    def send_whatsapp(
        cls,
        account_sid: str,
        auth_token: str,
        from_num: str,
        to_num: str,
        title: str,
        message: str,
        details: Optional[Dict[str, Any]] = None
    ) -> Tuple[bool, str]:
        """Sends an alert via Twilio WhatsApp API"""
        if not account_sid or not auth_token or not from_num or not to_num:
            return False, "Configuración de WhatsApp incompleta (Account SID, Auth Token o Teléfonos)."

        body = f"*{title}*\n{message}\n"
        if details:
            for k, v in details.items():
                body += f"• {k}: {v}\n"

        url = f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Messages.json"
        data = urllib.parse.urlencode({
            "From": f"whatsapp:{from_num.replace('whatsapp:', '')}",
            "To": f"whatsapp:{to_num.replace('whatsapp:', '')}",
            "Body": body
        }).encode("utf-8")

        import base64
        auth_header = "Basic " + base64.b64encode(f"{account_sid}:{auth_token}".encode("utf-8")).decode("utf-8")

        try:
            req = urllib_request.Request(url, data=data, headers={"Authorization": auth_header}, method="POST")
            with urllib_request.urlopen(req, timeout=10) as resp:
                if resp.status in (200, 201):
                    return True, "Mensaje de WhatsApp enviado correctamente."
                return False, f"Respuesta Twilio HTTP {resp.status}"
        except Exception as e:
            err_str = str(e)
            logger.error(f"[ALERT_SERVICE] Error enviando WhatsApp: {err_str}")
            return False, f"Fallo WhatsApp: {err_str}"

    @classmethod
    def send_alert(
        cls,
        title: str,
        message: str,
        severity: str = "INFO",
        details: Optional[Dict[str, Any]] = None,
        db = None
    ) -> bool:
        """
        Universal alert dispatcher called by background workers and backup engines.
        Dispatches silently according to user configuration in database.
        """
        config = cls.get_config(db)
        if not config or not config.is_enabled:
            return False

        # Filter by trigger preferences
        sev = severity.upper()
        if sev in ("INFO", "START") and not config.notify_on_start:
            return False
        if sev == "SUCCESS" and not config.notify_on_success:
            return False
        if (sev == "ERROR" or sev == "WARNING") and not config.notify_on_error:
            return False

        provider = (config.provider or "TELEGRAM").upper()

        if provider == "TELEGRAM":
            token = decrypt_secret(config.telegram_bot_token_encrypted)
            if not token or not config.telegram_chat_id:
                return False
            success, _ = cls.send_telegram(
                token=token,
                chat_id=config.telegram_chat_id,
                title=title,
                message=message,
                severity=severity,
                details=details
            )
            return success

        elif provider == "EMAIL":
            password = decrypt_secret(config.email_password_encrypted) or ""
            success, _ = cls.send_email(
                smtp_host=config.email_smtp_host or "",
                smtp_port=config.email_smtp_port or 587,
                sender=config.email_sender or "",
                recipients=config.email_recipients or "",
                password=password,
                use_tls=config.email_use_tls,
                title=title,
                message=message,
                severity=severity,
                details=details
            )
            return success

        elif provider == "WHATSAPP":
            auth_token = decrypt_secret(config.whatsapp_auth_token_encrypted) or ""
            success, _ = cls.send_whatsapp(
                account_sid=config.whatsapp_account_sid or "",
                auth_token=auth_token,
                from_num=config.whatsapp_from or "",
                to_num=config.whatsapp_to or "",
                title=title,
                message=message,
                details=details
            )
            return success

        return False
