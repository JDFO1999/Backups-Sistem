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
        from app.models import BackupJob, FolderBackupJob
        db = SessionLocal()
        
        # Recover database backup jobs
        interrupted_db = db.query(BackupJob).filter(BackupJob.status.in_(["RUNNING", "PENDING"])).all()
        for j in interrupted_db:
            j.status = "INTERRUPTED"
            j.current_step = "Interrumpido por reinicio o apagado de PC/servidor. Listo para reanudar."
            
        # Recover folder backup jobs
        interrupted_folder = db.query(FolderBackupJob).filter(FolderBackupJob.status.in_(["RUNNING", "PENDING"])).all()
        for fj in interrupted_folder:
            fj.status = "INTERRUPTED"
            fj.current_step = "Interrumpido por reinicio o apagado de PC/servidor. Listo para reanudar."
            
        total_rec = len(interrupted_db) + len(interrupted_folder)
        if total_rec > 0:
            db.commit()
            print(f"[RECOVERY] Se detectaron {total_rec} tarea(s) interrumpida(s) (DB: {len(interrupted_db)}, Carpetas: {len(interrupted_folder)}). Marcadas como INTERRUPTED.")
        db.close()
    except Exception as e:
        print(f"[RECOVERY] Error comprobando tareas pendientes: {e}")

    # Clean orphaned files in staging directory (> 24 hours old)
    try:
        import os, time
        staging_dir = settings.BACKUP_TEMP_DIR
        if os.path.exists(staging_dir):
            now_ts = time.time()
            cleaned_count = 0
            for root, dirs, files in os.walk(staging_dir):
                for fname in files:
                    fpath = os.path.join(root, fname)
                    try:
                        if os.path.isfile(fpath) and (now_ts - os.path.getmtime(fpath) > 86400):
                            os.remove(fpath)
                            cleaned_count += 1
                    except Exception:
                        pass
            if cleaned_count > 0:
                print(f"[STAGING CLEANUP] Se eliminaron {cleaned_count} archivo(s) residuales huérfanos (>24h).")
    except Exception as e:
        print(f"[STAGING CLEANUP] Error comprobando staging: {e}")

    # Launch automated scheduler daemon thread
    import threading
    from app.workers.tasks import start_scheduler_loop
    stop_scheduler_event = threading.Event()
    sched_thread = threading.Thread(target=start_scheduler_loop, args=(stop_scheduler_event,), daemon=True)
    sched_thread.start()

    yield

    stop_scheduler_event.set()

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="Sistema Profesional de Gestión y Automatización de Backups a Google Drive",
    lifespan=lifespan
)

# Security Headers Middleware
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response

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
