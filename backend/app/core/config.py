import os
from typing import List, Optional
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=True
    )

    # App General
    PROJECT_NAME: str = "Database Backup Manager"
    APP_NAME: str = "Database Backup Manager"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"
    ENVIRONMENT: str = "development"
    APP_URL: str = "http://localhost:5173"

    # Security & Tokens
    SECRET_KEY: str = "super_insecure_default_secret_please_change_in_production_32chars"
    MASTER_ENCRYPTION_KEY: str = "master_fernet_compatible_key_change_in_production="
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    ALGORITHM: str = "HS256"

    # Superuser Default (Seeded at startup)
    FIRST_SUPERUSER_EMAIL: str = "admin@example.com"
    FIRST_SUPERUSER_PASSWORD: str = "AdminSecurePass123!"
    FIRST_SUPERUSER_NAME: str = "Super Administrator"

    # Database
    DATABASE_URL: str = "sqlite:///./backup_manager.db"
    POSTGRES_SERVER: Optional[str] = "localhost"
    POSTGRES_PORT: Optional[int] = 5432
    POSTGRES_DB: Optional[str] = "db_backup_manager"
    POSTGRES_USER: Optional[str] = "postgres"
    POSTGRES_PASSWORD: Optional[str] = "postgres_secure_password"

    # Redis & Celery
    REDIS_URL: str = "redis://localhost:6379/0"
    CELERY_BROKER_URL: str = "redis://localhost:6379/1"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/2"

    # Google Drive OAuth 2.0
    GOOGLE_CLIENT_ID: Optional[str] = None
    GOOGLE_CLIENT_SECRET: Optional[str] = None
    GOOGLE_REDIRECT_URI: str = "http://localhost:8000/api/v1/google-drive/callback"

    # Backup & Staging Storage
    BACKUP_TEMP_DIR: str = "./backup_staging"
    MAX_STREAM_CHUNK_SIZE_MB: int = 50

    # SQL Server Sucursales / Branches
    SQLSERVER_BRANCH_HOST: str = "10.10.10.21"
    SQLSERVER_BRANCH_PORT: int = 1433
    SQLSERVER_BRANCH_USER: str = "Jose_Sistemas"
    SQLSERVER_BRANCH_PASSWORD: str = "Zuleidy14*$"
    SQLSERVER_BRANCH_DATABASE: str = "Sistemas"

    # CORS
    BACKEND_CORS_ORIGINS: List[str] = [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000"
    ]

settings = Settings()
