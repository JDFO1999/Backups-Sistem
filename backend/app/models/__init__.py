import datetime
from sqlalchemy import (
    Column, Integer, String, Text, Boolean, BigInteger, DateTime,
    ForeignKey, Table
)
from sqlalchemy.orm import relationship
from app.core.database import Base

def utcnow():
    return datetime.datetime.now(datetime.timezone.utc)

schedule_databases_table = Table(
    'schedule_databases',
    Base.metadata,
    Column('schedule_id', Integer, ForeignKey('backup_schedules.id', ondelete='CASCADE'), primary_key=True),
    Column('database_id', Integer, ForeignKey('databases.id', ondelete='CASCADE'), primary_key=True)
)

class Role(Base):
    __tablename__ = 'roles'

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(50), unique=True, nullable=False, index=True)
    description = Column(String(255), nullable=True)

    users = relationship('User', back_populates='role')

class User(Base):
    __tablename__ = 'users'

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True)
    role_id = Column(Integer, ForeignKey('roles.id'), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    role = relationship('Role', back_populates='users')
    jobs = relationship('BackupJob', back_populates='user')
    audit_logs = relationship('AuditLog', back_populates='user')

class Server(Base):
    __tablename__ = 'servers'

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False, index=True)
    host = Column(String(255), nullable=False)
    ssh_port = Column(Integer, default=22)
    username = Column(String(100), nullable=False)
    auth_type = Column(String(20), default='KEY') # KEY, PASSWORD
    os_type = Column(String(20), default='LINUX') # LINUX, WINDOWS
    encrypted_ssh_key = Column(Text, nullable=True)
    encrypted_password = Column(Text, nullable=True)
    os_info = Column(String(100), default='Linux')
    status = Column(String(30), default='UNKNOWN')
    last_contact_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    database_connections = relationship('DatabaseConnection', back_populates='server', cascade='all, delete-orphan')
    databases = relationship('Database', back_populates='server', cascade='all, delete-orphan')
    schedules = relationship('BackupSchedule', back_populates='server', cascade='all, delete-orphan')
    jobs = relationship('BackupJob', back_populates='server', cascade='all, delete-orphan')

class DatabaseConnection(Base):
    __tablename__ = 'database_connections'

    id = Column(Integer, primary_key=True, index=True)
    server_id = Column(Integer, ForeignKey('servers.id', ondelete='CASCADE'), nullable=False)
    engine = Column(String(50), nullable=False) # MYSQL, POSTGRESQL, MARIADB
    name = Column(String(100), nullable=False)
    host = Column(String(255), default='127.0.0.1')
    port = Column(Integer, nullable=False)
    username = Column(String(100), nullable=False)
    encrypted_password = Column(Text, nullable=True)
    status = Column(String(30), default='UNKNOWN')
    last_checked_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    server = relationship('Server', back_populates='database_connections')
    databases = relationship('Database', back_populates='connection', cascade='all, delete-orphan')

class Database(Base):
    __tablename__ = 'databases'

    id = Column(Integer, primary_key=True, index=True)
    server_id = Column(Integer, ForeignKey('servers.id', ondelete='CASCADE'), nullable=False)
    connection_id = Column(Integer, ForeignKey('database_connections.id', ondelete='CASCADE'), nullable=True)
    name = Column(String(150), nullable=False, index=True)
    engine = Column(String(50), nullable=False)
    size_bytes = Column(BigInteger, default=0)
    last_analyzed_at = Column(DateTime(timezone=True), nullable=True)
    last_backup_at = Column(DateTime(timezone=True), nullable=True)
    last_backup_size_bytes = Column(BigInteger, nullable=True)
    last_backup_status = Column(String(30), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    server = relationship('Server', back_populates='databases')
    connection = relationship('DatabaseConnection', back_populates='databases')
    schedules = relationship('BackupSchedule', secondary=schedule_databases_table, back_populates='databases')
    backup_files = relationship('BackupFile', back_populates='database', cascade='all, delete-orphan')

class GoogleDriveAccount(Base):
    __tablename__ = 'google_drive_accounts'

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), nullable=True)
    root_folder_id = Column(String(255), nullable=True)
    root_folder_name = Column(String(255), default='BACKUPS')
    encrypted_token_json = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)
    storage_total_bytes = Column(BigInteger, nullable=True)
    storage_used_bytes = Column(BigInteger, nullable=True)
    last_synced_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

class BackupSchedule(Base):
    __tablename__ = 'backup_schedules'

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(150), nullable=False)
    server_id = Column(Integer, ForeignKey('servers.id', ondelete='CASCADE'), nullable=False)
    cron_expression = Column(String(100), nullable=False)
    compression_type = Column(String(20), default='GZIP')
    retention_count = Column(Integer, default=7)
    retention_days = Column(Integer, default=30)
    is_active = Column(Boolean, default=True)
    last_run_at = Column(DateTime(timezone=True), nullable=True)
    next_run_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    server = relationship('Server', back_populates='schedules')
    databases = relationship('Database', secondary=schedule_databases_table, back_populates='schedules')
    jobs = relationship('BackupJob', back_populates='schedule')

class BackupJob(Base):
    __tablename__ = 'backup_jobs'

    id = Column(Integer, primary_key=True, index=True)
    server_id = Column(Integer, ForeignKey('servers.id', ondelete='CASCADE'), nullable=False)
    schedule_id = Column(Integer, ForeignKey('backup_schedules.id', ondelete='SET NULL'), nullable=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    trigger_type = Column(String(20), default='MANUAL')
    status = Column(String(30), default='PENDING', index=True)
    progress_percent = Column(Integer, default=0)
    current_step = Column(String(255), default='Iniciando...')
    error_message = Column(Text, nullable=True)
    total_original_size_bytes = Column(BigInteger, default=0)
    total_compressed_size_bytes = Column(BigInteger, default=0)
    target_database_ids = Column(Text, nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    finished_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    server = relationship('Server', back_populates='jobs')
    schedule = relationship('BackupSchedule', back_populates='jobs')
    user = relationship('User', back_populates='jobs')
    backup_files = relationship('BackupFile', back_populates='job', cascade='all, delete-orphan')

class BackupFile(Base):
    __tablename__ = 'backup_files'

    id = Column(Integer, primary_key=True, index=True)
    job_id = Column(Integer, ForeignKey('backup_jobs.id', ondelete='CASCADE'), nullable=False)
    database_id = Column(Integer, ForeignKey('databases.id', ondelete='CASCADE'), nullable=False)
    file_name = Column(String(255), nullable=False)
    file_size_bytes = Column(BigInteger, default=0)
    original_db_size_bytes = Column(BigInteger, default=0)
    sha256_checksum = Column(String(64), nullable=True)
    compression_algorithm = Column(String(20), default='gzip')
    google_drive_file_id = Column(String(255), nullable=True, index=True)
    google_drive_path = Column(String(500), nullable=True)
    status = Column(String(30), default='COMPLETED')
    created_at = Column(DateTime(timezone=True), default=utcnow)

    job = relationship('BackupJob', back_populates='backup_files')
    database = relationship('Database', back_populates='backup_files')
    restore_jobs = relationship('RestoreJob', back_populates='backup_file', cascade='all, delete-orphan')

class RestoreJob(Base):
    __tablename__ = 'restore_jobs'

    id = Column(Integer, primary_key=True, index=True)
    backup_file_id = Column(Integer, ForeignKey('backup_files.id', ondelete='CASCADE'), nullable=False)
    target_server_id = Column(Integer, ForeignKey('servers.id', ondelete='CASCADE'), nullable=False)
    target_database_name = Column(String(150), nullable=False)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    status = Column(String(30), default='PENDING', index=True) # PENDING, RUNNING, COMPLETED, FAILED
    progress_percent = Column(Integer, default=0)
    current_step = Column(String(255), default='Iniciando restauración...')
    error_message = Column(Text, nullable=True)
    overwrite = Column(Boolean, default=False)
    started_at = Column(DateTime(timezone=True), nullable=True)
    finished_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    backup_file = relationship('BackupFile', back_populates='restore_jobs')
    target_server = relationship('Server')
    user = relationship('User')

class AuditLog(Base):
    __tablename__ = 'audit_logs'

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    user_email = Column(String(255), nullable=True)
    action = Column(String(100), nullable=False, index=True)
    resource_type = Column(String(50), nullable=True)
    resource_id = Column(String(100), nullable=True)
    ip_address = Column(String(45), nullable=True)
    status = Column(String(20), default='SUCCESS')
    details_json = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    user = relationship('User', back_populates='audit_logs')

