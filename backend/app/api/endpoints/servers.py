from typing import List
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.deps import get_current_user, get_client_ip
from app.core.security import encrypt_secret, decrypt_secret
from app.models import Server, User
from app.schemas.server import (
    ServerCreate, ServerUpdate, ServerResponse, ServerTestResult
)
from app.services.ssh_service import SSHService
from app.services.audit_service import log_audit

router = APIRouter()

def _format_server_response(s: Server) -> ServerResponse:
    # If not yet tested and online, show clear pending status rather than default 'Linux'
    displayed_os = s.os_info
    if s.status != "ONLINE":
        displayed_os = f"{s.os_type or 'Servidor'} (Sin conectar)"
    elif not displayed_os:
        displayed_os = s.os_type or "Detectado"

    res = ServerResponse(
        id=s.id,
        name=s.name,
        host=s.host,
        ssh_port=s.ssh_port,
        username=s.username,
        auth_type=s.auth_type,
        os_type=getattr(s, 'os_type', 'LINUX') or 'LINUX',
        os_info=displayed_os,
        status=s.status,
        last_contact_at=s.last_contact_at,
        created_at=s.created_at,
        updated_at=s.updated_at,
        has_key=bool(s.encrypted_ssh_key),
        has_password=bool(s.encrypted_password)
    )
    return res

@router.get("", response_model=List[ServerResponse])
def list_servers(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    servers = db.query(Server).order_by(Server.id.desc()).all()
    return [_format_server_response(s) for s in servers]

@router.post("", response_model=ServerResponse, status_code=status.HTTP_201_CREATED)
def create_server(
    server_in: ServerCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    existing = db.query(Server).filter(Server.name == server_in.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Ya existe un servidor registrado con este nombre.")

    initial_os_info = f"{server_in.os_type} (Sin conectar)"

    server = Server(
        name=server_in.name,
        host=server_in.host,
        ssh_port=server_in.ssh_port,
        username=server_in.username,
        auth_type=server_in.auth_type,
        os_type=server_in.os_type.upper(),
        encrypted_ssh_key=encrypt_secret(server_in.ssh_key),
        encrypted_password=encrypt_secret(server_in.password),
        os_info=initial_os_info,
        status="UNKNOWN"
    )
    db.add(server)
    db.commit()
    db.refresh(server)

    log_audit(
        db, action="CREATE_SERVER",
        user=user,
        resource_type="SERVER",
        resource_id=server.id,
        ip_address=get_client_ip(request),
        details={"name": server.name, "host": server.host, "os_type": server.os_type}
    )

    return _format_server_response(server)

@router.get("/{server_id}", response_model=ServerResponse)
def get_server(
    server_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Servidor no encontrado.")
    return _format_server_response(server)

@router.put("/{server_id}", response_model=ServerResponse)
def update_server(
    server_id: int,
    server_in: ServerUpdate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Servidor no encontrado.")

    if server_in.name and server_in.name != server.name:
        existing = db.query(Server).filter(Server.name == server_in.name).first()
        if existing:
            raise HTTPException(status_code=400, detail="El nombre de servidor ya está en uso.")
        server.name = server_in.name

    if server_in.host:
        server.host = server_in.host
    if server_in.ssh_port:
        server.ssh_port = server_in.ssh_port
    if server_in.username:
        server.username = server_in.username
    if server_in.auth_type:
        server.auth_type = server_in.auth_type
    if server_in.os_type:
        server.os_type = server_in.os_type.upper()
        if server.status != "ONLINE":
            server.os_info = f"{server.os_type} (Sin conectar)"
    if server_in.ssh_key:
        server.encrypted_ssh_key = encrypt_secret(server_in.ssh_key)
    if server_in.password:
        server.encrypted_password = encrypt_secret(server_in.password)
    if server_in.os_info:
        server.os_info = server_in.os_info

    db.commit()
    db.refresh(server)

    log_audit(
        db, action="UPDATE_SERVER",
        user=user,
        resource_type="SERVER",
        resource_id=server.id,
        ip_address=get_client_ip(request),
        details={"name": server.name, "os_type": server.os_type}
    )

    return _format_server_response(server)

@router.delete("/{server_id}")
def delete_server(
    server_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Servidor no encontrado.")

    server_name = server.name
    db.delete(server)
    db.commit()

    log_audit(
        db, action="DELETE_SERVER",
        user=user,
        resource_type="SERVER",
        resource_id=server_id,
        ip_address=get_client_ip(request),
        details={"name": server_name}
    )

    return {"message": "Servidor eliminado exitosamente."}

@router.post("/{server_id}/test", response_model=ServerTestResult)
def test_server_connection(
    server_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Servidor no encontrado.")

    key = decrypt_secret(server.encrypted_ssh_key)
    pwd = decrypt_secret(server.encrypted_password)

    success, latency, detected_os, message = SSHService.test_connection(
        host=server.host,
        port=server.ssh_port,
        username=server.username,
        private_key_str=key,
        password=pwd,
        os_type=getattr(server, 'os_type', 'LINUX') or 'LINUX'
    )

    server.last_contact_at = datetime.now(timezone.utc)
    if success:
        server.status = "ONLINE"
        server.os_info = detected_os or f"{server.os_type} Activo"
    else:
        server.status = "OFFLINE"
    db.commit()

    return ServerTestResult(
        success=success,
        latency_ms=latency,
        os_detected=detected_os,
        message=message
    )

@router.post("/{server_id}/detect-engines")
def detect_engines(
    server_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Servidor no encontrado.")

    key = decrypt_secret(server.encrypted_ssh_key)
    pwd = decrypt_secret(server.encrypted_password)

    detected = SSHService.detect_database_engines(
        host=server.host,
        port=server.ssh_port,
        username=server.username,
        private_key_str=key,
        password=pwd,
        os_type=getattr(server, 'os_type', 'LINUX') or 'LINUX'
    )
    return detected
