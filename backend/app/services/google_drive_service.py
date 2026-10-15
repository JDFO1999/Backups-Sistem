import io
import os
import json
import logging
from typing import Optional, Dict, Any, Tuple
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
from app.core.config import settings

# Allow OAuth scope relaxation when Google appends openid automatically
os.environ['OAUTHLIB_RELAX_TOKEN_SCOPE'] = '1'

logger = logging.getLogger(__name__)

SCOPES = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/drive.file"
]

class GoogleDriveService:
    @staticmethod
    def get_auth_url() -> Tuple[str, str]:
        """Generate Google OAuth 2.0 authorization URL with offline access for refresh token"""
        flow = Flow.from_client_config(
            {
                "web": {
                    "client_id": settings.GOOGLE_CLIENT_ID or "missing_client_id",
                    "client_secret": settings.GOOGLE_CLIENT_SECRET or "missing_client_secret",
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                    "redirect_uris": [settings.GOOGLE_REDIRECT_URI]
                }
            },
            scopes=SCOPES,
            redirect_uri=settings.GOOGLE_REDIRECT_URI,
            autogenerate_code_verifier=False
        )
        auth_url, state = flow.authorization_url(
            access_type='offline',
            include_granted_scopes='true',
            prompt='consent'
        )
        return auth_url, state

    @staticmethod
    def exchange_code(code: str) -> Dict[str, Any]:
        """Exchange auth code for tokens and extract account email"""
        flow = Flow.from_client_config(
            {
                "web": {
                    "client_id": settings.GOOGLE_CLIENT_ID,
                    "client_secret": settings.GOOGLE_CLIENT_SECRET,
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                    "redirect_uris": [settings.GOOGLE_REDIRECT_URI]
                }
            },
            scopes=SCOPES,
            redirect_uri=settings.GOOGLE_REDIRECT_URI,
            autogenerate_code_verifier=False
        )
        flow.fetch_token(code=code)
        creds = flow.credentials
        
        token_info = {
            "token": creds.token,
            "refresh_token": creds.refresh_token,
            "token_uri": creds.token_uri,
            "client_id": creds.client_id,
            "client_secret": creds.client_secret,
            "scopes": creds.scopes
        }

        # Retrieve user email
        drive_service = build('drive', 'v3', credentials=creds)
        about = drive_service.about().get(fields="user").execute()
        user_email = about.get("user", {}).get("emailAddress", "unknown@gmail.com")

        return {
            "token_json": json.dumps(token_info),
            "email": user_email
        }

    @staticmethod
    def get_drive_client(token_json: str):
        token_data = json.loads(token_json)
        creds = Credentials.from_authorized_user_info(token_data, scopes=SCOPES)
        return build('drive', 'v3', credentials=creds, cache_discovery=False)

    @classmethod
    def get_storage_quota(cls, token_json: str) -> Dict[str, Any]:
        """Retrieve actual Google Drive storage quota using Drive API v3"""
        drive = cls.get_drive_client(token_json)
        about = drive.about().get(fields="storageQuota").execute()
        quota = about.get("storageQuota", {})

        limit = quota.get("limit") # In bytes, or None for unlimited
        usage = quota.get("usage") # In bytes
        usage_in_drive = quota.get("usageInDrive")

        total_bytes = int(limit) if limit is not None else None
        used_bytes = int(usage) if usage is not None else 0
        available_bytes = (total_bytes - used_bytes) if total_bytes is not None else None

        return {
            "total_bytes": total_bytes,
            "used_bytes": used_bytes,
            "available_bytes": available_bytes,
            "is_unlimited": total_bytes is None
        }

    @classmethod
    def execute_with_retry(cls, request_callable, max_retries: int = 10):
        """Execute a Google API request with exponential backoff retry on network/DNS drops"""
        import time
        retries = 0
        while True:
            try:
                return request_callable().execute()
            except Exception as e:
                retries += 1
                if retries > max_retries:
                    logger.error(f"Fallo definitivo en llamada a Google API tras {max_retries} reintentos: {e}")
                    raise
                sleep_s = min(2 ** retries, 60)
                logger.warning(f"Error transitorio en Google API ({e}). Reintento {retries}/{max_retries} en {sleep_s}s...")
                time.sleep(sleep_s)

    @classmethod
    def find_or_create_folder(
        cls,
        token_json: str,
        folder_name: str,
        parent_id: Optional[str] = None
    ) -> str:
        """Find folder by name and parent or create it with automatic retry on network drops"""
        drive = cls.get_drive_client(token_json)
        query = f"mimeType = 'application/vnd.google-apps.folder' and name = '{folder_name}' and trashed = false"
        if parent_id:
            query += f" and '{parent_id}' in parents"

        response = cls.execute_with_retry(lambda: drive.files().list(
            q=query,
            spaces='drive',
            fields='files(id, name)'
        ))

        files = response.get('files', [])
        if files:
            return files[0]['id']

        file_metadata = {
            'name': folder_name,
            'mimeType': 'application/vnd.google-apps.folder'
        }
        if parent_id:
            file_metadata['parents'] = [parent_id]

        folder = cls.execute_with_retry(lambda: drive.files().create(body=file_metadata, fields='id'))
        return folder.get('id')

    @classmethod
    def resolve_backup_folder_path(
        cls,
        token_json: str,
        root_folder_name: str,
        server_name: str,
        engine: str,
        db_name: str
    ) -> str:
        """Ensures hierarchy BACKUPS/{server_name}/{engine}/{db_name} exists and returns final folder id"""
        root_id = cls.find_or_create_folder(token_json, root_folder_name, parent_id=None)
        server_id = cls.find_or_create_folder(token_json, server_name, parent_id=root_id)
        engine_id = cls.find_or_create_folder(token_json, engine.lower(), parent_id=server_id)
        db_id = cls.find_or_create_folder(token_json, db_name, parent_id=engine_id)
        return db_id

    @classmethod
    def resolve_folder_backup_path(
        cls,
        token_json: str,
        root_folder_name: str,
        branch_code: str,
        branch_name: Optional[str] = None
    ) -> str:
        """Ensures hierarchy BACKUPS/CARPETAS_SUCURSALES/{branch_code} exists (created if first time) and returns folder id"""
        clean_code = branch_code.strip().upper()
        root_id = cls.find_or_create_folder(token_json, root_folder_name, parent_id=None)
        parent_id = cls.find_or_create_folder(token_json, "CARPETAS_SUCURSALES", parent_id=root_id)
        branch_folder_id = cls.find_or_create_folder(token_json, clean_code, parent_id=parent_id)
        return branch_folder_id

    @classmethod
    def upload_resumable_file(
        cls,
        token_json: str,
        local_filepath: str,
        destination_folder_id: str,
        remote_filename: str,
        progress_callback=None
    ) -> Dict[str, Any]:
        """Upload file using Google Drive Resumable Upload in controlled chunks with progress"""
        drive = cls.get_drive_client(token_json)

        file_metadata = {
            'name': remote_filename,
            'parents': [destination_folder_id]
        }

        # 10MB chunk size
        chunk_size = 10 * 1024 * 1024
        media = MediaFileUpload(
            local_filepath,
            mimetype='application/gzip',
            chunksize=chunk_size,
            resumable=True
        )

        request = drive.files().create(
            body=file_metadata,
            media_body=media,
            fields='id, name, size, md5Checksum'
        )

        response = None
        while response is None:
            retries = 0
            max_retries = 10
            while True:
                try:
                    status, response = request.next_chunk()
                    if status and progress_callback:
                        progress_callback(status.progress())
                    break
                except Exception as e:
                    retries += 1
                    if retries > max_retries:
                        logger.error(f"Fallo definitivo subiendo bloque a Google Drive tras {max_retries} reintentos: {e}")
                        raise
                    sleep_time = min(2 ** retries, 60)
                    logger.warning(f"Error transitorio en Google Drive ({e}). Reintento {retries}/{max_retries} en {sleep_time}s...")
                    import time
                    time.sleep(sleep_time)

        return response


    @classmethod
    def clean_branch_folder_in_drive(cls, token_json: str, root_folder_name: str, branch_code: str) -> int:
        """Finds and deletes any backup files inside the branch folder in Google Drive to start completely fresh"""
        try:
            drive = cls.get_drive_client(token_json)
            folder_id = cls.resolve_folder_backup_path(token_json, root_folder_name, branch_code)
            query = f"'{folder_id}' in parents and trashed = false"
            res = cls.execute_with_retry(lambda: drive.files().list(q=query, fields='files(id, name)').execute())
            files = res.get('files', [])
            count = 0
            for f in files:
                drive.files().delete(fileId=f['id']).execute()
                count += 1
            logger.info(f"Limpieza en Google Drive: eliminados {count} archivo(s) en carpeta de {branch_code}")
            return count
        except Exception as e:
            logger.warning(f"Error limpiando carpeta de {branch_code} en Google Drive: {e}")
            return 0

    @classmethod
    def delete_file(cls, token_json: str, file_id: str) -> bool:
        try:
            drive = cls.get_drive_client(token_json)
            drive.files().delete(fileId=file_id).execute()
            return True
        except Exception as e:
            logger.error(f"Error eliminando archivo {file_id} de Google Drive: {e}")
            return False

    @classmethod
    def download_file(cls, token_json: str, file_id: str, destination_path: str, progress_callback=None) -> None:
        """Download file chunks from Google Drive"""
        from googleapiclient.http import MediaIoBaseDownload
        drive = cls.get_drive_client(token_json)
        request = drive.files().get_media(fileId=file_id)
        with open(destination_path, 'wb') as fh:
            downloader = MediaIoBaseDownload(fh, request, chunksize=10*1024*1024)
            done = False
            while not done:
                retries = 0
                max_retries = 10
                while True:
                    try:
                        status, done = downloader.next_chunk()
                        if status and progress_callback:
                            progress_callback(int(status.progress() * 100))
                        break
                    except Exception as e:
                        retries += 1
                        if retries > max_retries:
                            logger.error(f"Fallo definitivo descargando bloque de Google Drive tras {max_retries} reintentos: {e}")
                            raise
                        sleep_time = min(2 ** retries, 60)
                        logger.warning(f"Error transitorio descargando de Google Drive ({e}). Reintento {retries}/{max_retries} en {sleep_time}s...")
                        time.sleep(sleep_time)

    @classmethod
    def get_download_stream(cls, token_json: str, file_id: str, chunk_size: int = 8 * 1024 * 1024):
        """
        Stream binary data directly from Google Drive in chunks.
        Yields chunk by chunk for HTTP streaming responses.
        """
        from googleapiclient.http import MediaIoBaseDownload
        drive = cls.get_drive_client(token_json)
        request = drive.files().get_media(fileId=file_id)

        buf = io.BytesIO()
        downloader = MediaIoBaseDownload(buf, request, chunksize=chunk_size)
        done = False
        while not done:
            retries = 0
            max_retries = 5
            while True:
                try:
                    buf.seek(0)
                    buf.truncate(0)
                    status, done = downloader.next_chunk()
                    buf.seek(0)
                    data = buf.read()
                    if data:
                        yield data
                    break
                except Exception as e:
                    retries += 1
                    if retries > max_retries:
                        logger.error(f"Fallo definitivo leyendo bloque de Google Drive ({file_id}): {e}")
                        raise
                    import time
                    time.sleep(min(2 ** retries, 15))

    @classmethod
    def get_file_links(cls, token_json: str, file_id: str) -> Dict[str, Optional[str]]:
        """Get webViewLink and webContentLink from Google Drive for direct browser access"""
        try:
            drive = cls.get_drive_client(token_json)
            meta = drive.files().get(fileId=file_id, fields="id, name, webViewLink, webContentLink, size").execute()
            return {
                "web_view_link": meta.get("webViewLink"),
                "web_content_link": meta.get("webContentLink"),
                "size": meta.get("size")
            }
        except Exception as e:
            logger.warning(f"Error fetching file links from Google Drive for {file_id}: {e}")
            return {
                "web_view_link": f"https://drive.google.com/file/d/{file_id}/view",
                "web_content_link": f"https://drive.google.com/uc?id={file_id}&export=download",
                "size": None
            }


    @classmethod
    def upload_stream_resumable(
        cls,
        token_json: str,
        stream_reader,
        destination_folder_id: str,
        remote_filename: str,
        compress: bool = True,
        progress_callback=None
    ) -> Dict[str, Any]:
        """
        Stream binary data directly into Google Drive in real-time.
        Chunks of 8MB are buffered, compressed in real-time with gzip,
        and sent to Google Drive's resumable upload endpoint.
        """
        import time
        import zlib
        import hashlib
        import requests
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import Request

        creds = Credentials.from_authorized_user_info(json.loads(token_json), scopes=SCOPES)
        init_url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable"
        session_url = None
        init_retries = 0
        max_init_retries = 10

        while True:
            try:
                if creds.expired or not creds.valid:
                    creds.refresh(Request())
                access_token = creds.token

                headers = {
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json; charset=UTF-8",
                    "X-Upload-Content-Type": "application/gzip" if compress else "application/octet-stream",
                }
                metadata = {
                    "name": remote_filename,
                    "parents": [destination_folder_id]
                }

                init_resp = requests.post(init_url, headers=headers, json=metadata, timeout=30)
                if init_resp.status_code in [200, 201]:
                    session_url = init_resp.headers.get("Location")
                    if session_url:
                        break
                    raise RuntimeError("Google Drive no proporcionó la URL de sesión de subida (Location header).")
                else:
                    raise RuntimeError(f"Error iniciando sesión de subida en Google Drive: {init_resp.status_code} - {init_resp.text}")
            except Exception as e:
                init_retries += 1
                if init_retries > max_init_retries:
                    logger.error(f"Fallo definitivo iniciando sesión de subida en Google Drive: {e}")
                    raise
                sleep_s = min(2 ** init_retries, 60)
                logger.warning(f"Error transitorio iniciando sesión en Google Drive ({e}). Reintento {init_retries}/{max_init_retries} en {sleep_s}s...")
                time.sleep(sleep_s)

        # Google Drive requires chunks to be multiples of 256 KiB (262,144 bytes)
        # 32 MiB = 33,554,432 bytes (128 * 256 KiB) - 4x larger chunks for maximum transmission throughput
        CHUNK_SIZE = 32 * 1024 * 1024
        # Level 1 (fastest compression) is ~3-4x faster on CPU while retaining ~90% compression ratio
        compressor = zlib.compressobj(level=1, wbits=31) if compress else None

        buffer = bytearray()
        total_compressed_sent = 0
        total_raw_read = 0
        sha256 = hashlib.sha256()

        # Reusable HTTP session with connection pooling for maximum keep-alive performance
        http_session = requests.Session()
        adapter = requests.adapters.HTTPAdapter(pool_connections=5, pool_maxsize=10, max_retries=3)
        http_session.mount("https://", adapter)

        def _send_chunk_with_retry(chunk_bytes: bytes, content_range_str: str, is_final: bool = False):
            retries = 0
            max_retries = 10
            while True:
                try:
                    nonlocal access_token, creds
                    if creds.expired or not creds.valid:
                        creds.refresh(Request())
                        access_token = creds.token

                    h = {
                        "Authorization": f"Bearer {access_token}",
                        "Content-Range": content_range_str,
                        "Content-Length": str(len(chunk_bytes))
                    }
                    resp = http_session.put(session_url, headers=h, data=chunk_bytes, timeout=180)
                    if is_final:
                        if resp.status_code in [200, 201]:
                            return resp
                        else:
                            raise RuntimeError(f"Fallo en bloque final de Google Drive ({resp.status_code}): {resp.text}")
                    else:
                        if resp.status_code == 308:
                            return resp
                        elif resp.status_code in [200, 201]:
                            return resp
                        else:
                            raise RuntimeError(f"Fallo en bloque intermedio de Google Drive ({resp.status_code}): {resp.text}")
                except Exception as e:
                    retries += 1
                    if retries > max_retries:
                        logger.error(f"Error definitivo subiendo bloque streaming a Google Drive: {e}")
                        raise
                    sleep_s = min(2 ** retries, 60)
                    logger.warning(f"Error transitorio en stream de Google Drive ({e}). Reintentando {retries}/{max_retries} en {sleep_s}s...")
                    time.sleep(sleep_s)

        while True:
            raw_chunk = stream_reader.read(1024 * 1024 * 2)
            if not raw_chunk:
                break
            total_raw_read += len(raw_chunk)

            if compressor:
                out = compressor.compress(raw_chunk)
            else:
                out = raw_chunk

            if out:
                buffer.extend(out)
                sha256.update(out)

            while len(buffer) >= CHUNK_SIZE:
                chunk_to_send = bytes(buffer[:CHUNK_SIZE])
                del buffer[:CHUNK_SIZE]

                start_b = total_compressed_sent
                end_b = start_b + len(chunk_to_send) - 1
                cr = f"bytes {start_b}-{end_b}/*"

                _send_chunk_with_retry(chunk_to_send, cr, is_final=False)
                total_compressed_sent += len(chunk_to_send)

                if progress_callback:
                    progress_callback(total_raw_read, total_compressed_sent)

        # Flush compressor at EOF
        if compressor:
            tail = compressor.flush()
            if tail:
                buffer.extend(tail)
                sha256.update(tail)

        # Send final chunk
        final_total = total_compressed_sent + len(buffer)
        if len(buffer) > 0:
            start_b = total_compressed_sent
            end_b = final_total - 1
            cr = f"bytes {start_b}-{end_b}/{final_total}"
            final_resp = _send_chunk_with_retry(bytes(buffer), cr, is_final=True)
        else:
            cr = f"bytes */{final_total}"
            final_resp = _send_chunk_with_retry(b"", cr, is_final=True)

        drive_file_id = final_resp.json().get("id")

        return {
            "id": drive_file_id,
            "raw_size_bytes": total_raw_read,
            "compressed_size_bytes": final_total,
            "sha256_checksum": sha256.hexdigest()
        }


