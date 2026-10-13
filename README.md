# Database Backup Manager to Google Drive (Enterprise Edition)

Sistema integral de grado empresarial para la automatización, análisis, compresión y respaldo seguro de bases de datos remotas (MySQL, MariaDB, PostgreSQL) hacia **Google Drive API**.

---

## 🏗️ Arquitectura del Sistema

```
                 ┌─────────────────┐
                 │   Navegador     │
                 │ React + TS + TW │
                 └────────┬────────┘
                          │ HTTP REST / WebSocket
                          ▼
                 ┌─────────────────┐
                 │  FastAPI Core   │
                 │ Auth/RBAC/Audit │
                 └───────┬─────────┘
                         │
               ┌─────────┴─────────┐
               ▼                   ▼
          PostgreSQL             Redis
        (Metadata/Logs)       (Broker & State)
                                   │
                                   ▼
                            ┌──────────────┐
                            │    Worker    │
                            │ Backup Engine│
                            └──────┬───────┘
                                   │
                    ┌──────────────┴─────────────┐
                    ▼                            ▼
             Servidor Linux                Google Drive
             MySQL / Postgres               API v3
```

- **Frontend**: React 19, TypeScript, Tailwind CSS, Lucide Icons, Vite.
- **Backend**: FastAPI (Python 3.11+), Pydantic v2, SQLAlchemy 2.0.
- **Procesamiento Asíncrono**: Celery + Redis.
- **Planificador**: Celery Beat (expresiones Cron).
- **Conectividad Segura**: Paramiko (SSH con cifrado AES-256-GCM para claves privadas).
- **Almacenamiento**: Google Drive API v3 (Protocolo Resumable Upload en chunks sin saturar memoria RAM).
- **Seguridad**: Autenticación JWT, contraseñas hasheadas con bcrypt (12 rounds), RBAC (ADMIN / USER), registro inmutable de auditoría.

---

## 🚀 Despliegue con Docker Compose (Recomendado para Servidores Linux)

### 1. Clonar y configurar variables de entorno
```bash
cp .env.example .env
```
Edite `.env` y configure sus credenciales de Google OAuth:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI` (ej: `http://tudominio.com/api/v1/google-drive/callback` o `http://localhost:8000/api/v1/google-drive/callback`)

### 2. Iniciar todos los servicios
```bash
docker compose up -d --build
```

Esto levantará automáticamente:
1. `db_backup_postgres`: Base de datos interna de configuración, metadatos y logs.
2. `db_backup_redis`: Broker de mensajería y pub/sub para WebSocket.
3. `db_backup_backend`: API REST y WebSockets en el puerto `8000`.
4. `db_backup_worker`: Motor de volcado SSH, compresión gzip y subida a Google Drive.
5. `db_backup_scheduler`: Planificador automático de tareas según expresiones cron y retención.
6. `db_backup_frontend`: Interfaz web moderna servida por Nginx en el puerto `3000` (o `80`).

---

## 💻 Ejecución en Modo Desarrollo Local (Sin Docker)

### Backend:
```bash
cd backend
python -m venv venv
# En Windows: .\venv\Scripts\activate | En Linux: source venv/bin/activate
pip install -r requirements.txt
python -m app.core.init_db
uvicorn app.main:app --reload --port 8000
```

### Frontend:
```bash
cd frontend
npm install
npm run dev
```

Abra el navegador en `http://localhost:5173`.
Credenciales de acceso inicial:
- **Email**: `admin@example.com`
- **Contraseña**: `AdminSecurePass123!`

---

## 🔒 Configuración de Google Drive OAuth 2.0

1. Vaya a [Google Cloud Console](https://console.cloud.google.com/).
2. Cree un proyecto nuevo y active la API **Google Drive API**.
3. En **Pantalla de consentimiento de OAuth**, seleccione tipo **Externo** o **Interno**.
4. Agregue el scope: `https://www.googleapis.com/auth/drive.file`.
5. En **Credenciales**, cree un **ID de cliente de OAuth 2.0** (Tipo: Aplicación web).
6. Configure como URI de redireccionamiento autorizada:
   `http://localhost:8000/api/v1/google-drive/callback` (o su dominio público).
7. Copie el ID de cliente y el Secreto de cliente en su archivo `.env`.

---

## 🧪 Pruebas Automatizadas

Para ejecutar la suite de pruebas unitarias y de integración del backend:
```bash
cd backend
pytest -v
```

---

## 📦 Arquitectura de Restauración (Preparada para Fase Futura)

El sistema ya registra los metadatos de integridad necesarios para la restauración:
1. **Google Drive File ID** y ruta jerárquica.
2. **Checksum SHA-256** para verificación estricta de integridad post-descarga.
3. **Flujo previsto**:
   ```
   Google Drive (Download) -> Verificación SHA-256 -> Decompress (gzip) -> SSH Pipe to mysql/psql
   ```
