from typing import List
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.deps import get_current_user, get_client_ip
from app.core.security import decrypt_secret, encrypt_secret
from app.models import Server, Database, DatabaseConnection, BackupFile, User
from app.schemas.database import (
    DatabaseResponse, DatabaseEstimateRequest, DatabaseEstimateResponse,
    DatabaseConnectionCreate
)
from app.services.db_inspector import DatabaseInspector
from app.services.audit_service import log_audit
from app.utils.formatters import format_bytes

router = APIRouter()

def _format_db_response(db_item: Database) -> DatabaseResponse:
    res = DatabaseResponse(
        id=db_item.id,
        server_id=db_item.server_id,
        connection_id=db_item.connection_id,
        name=db_item.name,
        engine=db_item.engine,
        size_bytes=db_item.size_bytes or 0,
        size_formatted=format_bytes(db_item.size_bytes or 0),
        last_analyzed_at=db_item.last_analyzed_at,
        last_backup_at=db_item.last_backup_at,
        last_backup_size_bytes=db_item.last_backup_size_bytes,
        last_backup_status=db_item.last_backup_status
    )
    return res

@router.get("/server/{server_id}", response_model=List[DatabaseResponse])
def get_databases_by_server(
    server_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    items = db.query(Database).filter(Database.server_id == server_id).all()
    return [_format_db_response(item) for item in items]

@router.post("/server/{server_id}/discover", response_model=List[DatabaseResponse])
def discover_server_databases(
    server_id: int,
    conn_params: DatabaseConnectionCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Servidor no encontrado.")

    ssh_key = decrypt_secret(server.encrypted_ssh_key)
    ssh_pwd = decrypt_secret(server.encrypted_password)
    os_type = getattr(server, 'os_type', 'LINUX') or 'LINUX'

    detected = []
    if conn_params.engine in ["MYSQL", "MARIADB"]:
        detected = DatabaseInspector.inspect_mysql(
            ssh_host=server.host,
            ssh_port=server.ssh_port,
            ssh_user=server.username,
            ssh_key=ssh_key,
            ssh_password=ssh_pwd,
            db_host=conn_params.host,
            db_port=conn_params.port,
            db_user=conn_params.username,
            db_password=conn_params.password,
            os_type=os_type
        )
    elif conn_params.engine == "POSTGRESQL":
        detected = DatabaseInspector.inspect_postgres(
            ssh_host=server.host,
            ssh_port=server.ssh_port,
            ssh_user=server.username,
            ssh_key=ssh_key,
            ssh_password=ssh_pwd,
            db_host=conn_params.host,
            db_port=conn_params.port,
            db_user=conn_params.username,
            db_password=conn_params.password,
            os_type=os_type
        )
    elif conn_params.engine == "SQLSERVER":
        detected = DatabaseInspector.inspect_sqlserver(
            ssh_host=server.host,
            ssh_port=server.ssh_port,
            ssh_user=server.username,
            ssh_key=ssh_key,
            ssh_password=ssh_pwd,
            db_host=conn_params.host,
            db_port=conn_params.port,
            db_user=conn_params.username,
            db_password=conn_params.password,
            os_type=os_type
        )

    db_conn = db.query(DatabaseConnection).filter(
        DatabaseConnection.server_id == server_id,
        DatabaseConnection.engine == conn_params.engine,
        DatabaseConnection.name == conn_params.name
    ).first()

    if not db_conn:
        db_conn = DatabaseConnection(
            server_id=server_id,
            engine=conn_params.engine,
            name=conn_params.name,
            host=conn_params.host,
            port=conn_params.port,
            username=conn_params.username,
            encrypted_password=encrypt_secret(conn_params.password),
            status="CONNECTED",
            last_checked_at=datetime.now(timezone.utc)
        )
        db.add(db_conn)
        db.commit()
        db.refresh(db_conn)

    synced = []
    now = datetime.now(timezone.utc)
    for d in detected:
        existing = db.query(Database).filter(
            Database.server_id == server_id,
            Database.name == d["name"]
        ).first()

        if existing:
            existing.size_bytes = d["size_bytes"]
            existing.last_analyzed_at = now
            existing.engine = conn_params.engine
            existing.connection_id = db_conn.id
            synced.append(existing)
        else:
            new_db = Database(
                server_id=server_id,
                connection_id=db_conn.id,
                name=d["name"],
                engine=conn_params.engine,
                size_bytes=d["size_bytes"],
                last_analyzed_at=now
            )
            db.add(new_db)
            synced.append(new_db)

    db.commit()

    log_audit(
        db, action="DISCOVER_DATABASES",
        user=user,
        resource_type="SERVER",
        resource_id=server_id,
        ip_address=get_client_ip(request),
        details={"engine": conn_params.engine, "count": len(detected), "os_type": os_type}
    )

    return [_format_db_response(item) for item in synced]

@router.post("/estimate", response_model=DatabaseEstimateResponse)
def estimate_backup_size(
    req: DatabaseEstimateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    if not req.database_ids:
        return DatabaseEstimateResponse(
            selected_count=0,
            total_original_bytes=0,
            total_original_formatted="0 B",
            estimated_compressed_bytes=0,
            estimated_compressed_formatted="0 B"
        )

    databases = db.query(Database).filter(Database.id.in_(req.database_ids)).all()
    total_original = sum(d.size_bytes or 0 for d in databases)

    historical_files = db.query(BackupFile).filter(
        BackupFile.database_id.in_(req.database_ids),
        BackupFile.status == "COMPLETED",
        BackupFile.original_db_size_bytes > 0,
        BackupFile.file_size_bytes > 0
    ).all()

    if historical_files:
        ratios = [f.file_size_bytes / float(f.original_db_size_bytes) for f in historical_files]
        avg_ratio = min(max(sum(ratios) / len(ratios), 0.1), 0.9)
    else:
        avg_ratio = 0.55

    estimated_compressed = int(total_original * avg_ratio)

    return DatabaseEstimateResponse(
        selected_count=len(databases),
        total_original_bytes=total_original,
        total_original_formatted=format_bytes(total_original),
        estimated_compressed_bytes=estimated_compressed,
        estimated_compressed_formatted=format_bytes(estimated_compressed)
    )
