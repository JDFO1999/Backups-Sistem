from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel, Field

class DatabaseConnectionCreate(BaseModel):
    engine: str = Field(..., pattern="^(MYSQL|POSTGRESQL|MARIADB|SQLSERVER)$")
    name: str
    host: str = "127.0.0.1"
    port: int
    username: str
    password: Optional[str] = None

class DatabaseResponse(BaseModel):
    id: int
    server_id: int
    connection_id: Optional[int] = None
    name: str
    engine: str
    size_bytes: int = 0
    size_formatted: Optional[str] = None
    last_analyzed_at: Optional[datetime] = None
    last_backup_at: Optional[datetime] = None
    last_backup_size_bytes: Optional[int] = None
    last_backup_status: Optional[str] = None

    class Config:
        from_attributes = True

class DatabaseEstimateRequest(BaseModel):
    database_ids: List[int]

class DatabaseEstimateResponse(BaseModel):
    selected_count: int
    total_original_bytes: int
    total_original_formatted: str
    estimated_compressed_bytes: int
    estimated_compressed_formatted: str
    disclaimer: str = "El tamaño final puede variar dependiendo del contenido y nivel de compresión."
