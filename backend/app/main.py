from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.init_db import init_db
from app.api.api_v1 import api_router
from app.api.websockets import progress as ws_progress

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Initialize DB and seeds
    init_db()

    # Auto-recovery: detect jobs interrupted by server restart
    try:
        from app.core.database import SessionLocal
        from app.models import BackupJob
        db = SessionLocal()
        interrupted = db.query(BackupJob).filter(BackupJob.status == "RUNNING").all()
        for j in interrupted:
            j.status = "INTERRUPTED"
            j.current_step = "Interrumpido por reinicio o corte de conexión. Listo para reanudar."
        if interrupted:
            db.commit()
            print(f"[RECOVERY] Se detectaron {len(interrupted)} tarea(s) interrumpida(s). Marcadas como INTERRUPTED.")
        db.close()
    except Exception as e:
        print(f"[RECOVERY] Error comprobando tareas pendientes: {e}")

    yield

    # Shutdown logic if needed

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="Sistema Profesional de Gestión y Automatización de Backups a Google Drive",
    lifespan=lifespan
)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.BACKEND_CORS_ORIGINS or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Health Checks
@app.get("/health", tags=["Health"])
def health_check():
    return {
        "status": "healthy",
        "app": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "environment": settings.ENVIRONMENT
    }

@app.get("/ready", tags=["Health"])
def readiness_check():
    from app.core.database import SessionLocal
    from sqlalchemy import text
    db = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
        return {"status": "ready", "database": "connected"}
    except Exception as e:
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"status": "not_ready", "error": "Database unreachable"}
        )
    finally:
        db.close()

# Include REST API
app.include_router(api_router, prefix=settings.API_V1_STR)

# Root-level OAuth2 Callbacks (Standard Google Cloud Console URI formats)
@app.get("/oauth2callback", tags=["Google Drive"])
@app.get("/callback", tags=["Google Drive"])
def root_oauth2_callback(code: str):
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url=f"{settings.API_V1_STR}/google-drive/callback?code={code}")

# Include WebSocket
app.include_router(ws_progress.router, prefix="/ws", tags=["WebSockets"])
