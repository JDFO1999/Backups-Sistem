from celery import Celery
from app.core.config import settings

celery = Celery(
    "backup_tasks",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=["app.workers.tasks"]
)

celery.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=14400, # 4 hours max per task for huge databases
    beat_schedule={
        "check-scheduled-backups-every-minute": {
            "task": "app.workers.tasks.check_scheduled_backups",
            "schedule": 60.0
        }
    }
)
