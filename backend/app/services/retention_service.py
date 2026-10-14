import logging
from datetime import datetime, timezone, timedelta
from sqlalchemy.orm import Session
from app.models import BackupFile, Database, BackupSchedule
from app.services.google_drive_service import GoogleDriveService
from app.services.audit_service import log_audit

logger = logging.getLogger(__name__)

class RetentionService:
    @classmethod
    def apply_retention_policy(
        cls,
        db: Session,
        schedule: BackupSchedule,
        database_id: int,
        drive_token_json: str
    ) -> int:
        deleted_count = 0
        try:
            now = datetime.now(timezone.utc)
            files = db.query(BackupFile).filter(
                BackupFile.database_id == database_id,
                BackupFile.status == "COMPLETED"
            ).order_by(BackupFile.created_at.desc()).all()

            # Files to keep by count
            keep_count = schedule.retention_count or 7
            max_days = schedule.retention_days or 30
            cutoff_date = now - timedelta(days=max_days)

            for idx, file in enumerate(files):
                should_delete = False
                reason = ""

                # Check count threshold
                if idx >= keep_count:
                    should_delete = True
                    reason = f"Excede límite de retención por cantidad ({keep_count} backups)"
                # Check age threshold
                elif file.created_at and file.created_at < cutoff_date:
                    should_delete = True
                    reason = f"Excede límite de retención por antigüedad ({max_days} días)"

                if should_delete:
                    # Delete from Google Drive if ID exists
                    if file.google_drive_file_id:
                        GoogleDriveService.delete_file(drive_token_json, file.google_drive_file_id)

                    file.status = "DELETED"
                    deleted_count += 1

                    log_audit(
                        db,
                        action="RETENTION_DELETE_BACKUP",
                        resource_type="BACKUP_FILE",
                        resource_id=file.id,
                        details={"file_name": file.file_name, "reason": reason}
                    )

            db.commit()
        except Exception as e:
            logger.error(f"Error aplicando política de retención: {e}")
            db.rollback()

        return deleted_count

    @classmethod
    def apply_folder_retention_policy(
        cls,
        db: Session,
        schedule: BackupSchedule,
        branch_id: int,
        drive_token_json: str
    ) -> int:
        deleted_count = 0
        try:
            from app.models import FolderBackupFile
            now = datetime.now(timezone.utc)
            files = db.query(FolderBackupFile).filter(
                FolderBackupFile.branch_id == branch_id,
                FolderBackupFile.status == "COMPLETED"
            ).order_by(FolderBackupFile.created_at.desc()).all()

            keep_count = schedule.retention_count or 7
            max_days = schedule.retention_days or 30
            cutoff_date = now - timedelta(days=max_days)

            for idx, file in enumerate(files):
                should_delete = False
                reason = ""

                if idx >= keep_count:
                    should_delete = True
                    reason = f"Excede límite de retención por cantidad ({keep_count} respaldos de sucursal)"
                elif file.created_at and file.created_at < cutoff_date:
                    should_delete = True
                    reason = f"Excede límite de retención por antigüedad ({max_days} días)"

                if should_delete:
                    if file.google_drive_file_id:
                        try:
                            GoogleDriveService.delete_file(drive_token_json, file.google_drive_file_id)
                        except Exception as de:
                            logger.warning(f"Error borrando archivo de Drive en retención: {de}")

                    db.delete(file)
                    deleted_count += 1

                    log_audit(
                        db,
                        action="RETENTION_DELETE_FOLDER_BACKUP",
                        resource_type="FOLDER_BACKUP_FILE",
                        resource_id=file.id,
                        details={"file_name": file.file_name, "reason": reason}
                    )

            db.commit()
        except Exception as e:
            logger.error(f"Error aplicando política de retención en carpetas: {e}")
            db.rollback()

        return deleted_count

