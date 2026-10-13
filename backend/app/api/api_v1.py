from fastapi import APIRouter
from app.api.endpoints import (
    auth, users, servers, databases, backups, google_drive, schedules, audit, dashboard, folder_backups
)

api_router = APIRouter()

api_router.include_router(auth.router, prefix="/auth", tags=["Autenticación"])
api_router.include_router(users.router, prefix="/users", tags=["Usuarios y Permisos"])
api_router.include_router(servers.router, prefix="/servers", tags=["Servidores Linux"])
api_router.include_router(databases.router, prefix="/databases", tags=["Bases de Datos"])
api_router.include_router(backups.router, prefix="/backups", tags=["Backups"])
api_router.include_router(folder_backups.router, prefix="/folders", tags=["Respaldo de Carpetas"])
api_router.include_router(google_drive.router, prefix="/google-drive", tags=["Google Drive"])
api_router.include_router(schedules.router, prefix="/schedules", tags=["Programación y Retención"])
api_router.include_router(audit.router, prefix="/audit", tags=["Auditoría"])
api_router.include_router(dashboard.router, prefix="/dashboard", tags=["Dashboard"])
