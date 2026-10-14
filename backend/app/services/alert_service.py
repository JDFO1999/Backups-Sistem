import json
import logging
from typing import Optional, Dict, Any
from urllib import request as urllib_request
from app.core.config import settings

logger = logging.getLogger(__name__)

class AlertService:
    @staticmethod
    def send_alert(
        title: str,
        message: str,
        severity: str = "INFO",
        details: Optional[Dict[str, Any]] = None
    ) -> bool:
        """
        Sends an alert notification to a configured Webhook URL (Discord, Slack, MS Teams, etc.)
        Silently succeeds or logs error without interrupting backup workflows.
        """
        webhook_url = settings.ALERT_WEBHOOK_URL
        if not webhook_url:
            return False

        # Color mapping for Discord / Slack embeds
        color_map = {
            "INFO": 0x3B82F6,      # Blue
            "SUCCESS": 0x10B981,   # Green
            "WARNING": 0xF59E0B,   # Amber
            "ERROR": 0xEF4444      # Red
        }
        color = color_map.get(severity.upper(), 0x3B82F6)

        # Discord / Slack compatible payload format
        payload = {
            "content": f"**[{severity.upper()}] {title}**\n{message}",
            "embeds": [
                {
                    "title": title,
                    "description": message,
                    "color": color,
                    "fields": [
                        {"name": k, "value": str(v), "inline": True}
                        for k, v in (details or {}).items()
                    ] if details else []
                }
            ]
        }

        try:
            req = urllib_request.Request(
                webhook_url,
                data=json.dumps(payload).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "User-Agent": "BackupMaster-AlertService/1.0"
                },
                method="POST"
            )
            with urllib_request.urlopen(req, timeout=5) as response:
                return response.status in (200, 204)
        except Exception as e:
            logger.warning(f"[ALERT_SERVICE] Error sending webhook notification: {e}")
            return False
