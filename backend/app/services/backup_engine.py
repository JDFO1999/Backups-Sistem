import os
import gzip
import shlex
import shutil
import logging
from datetime import datetime, timezone
from typing import Dict, Any, Callable, Optional
from app.core.config import settings
from app.services.ssh_service import SSHService
from app.services.google_drive_service import GoogleDriveService
from app.utils.formatters import calculate_sha256

logger = logging.getLogger(__name__)

class BackupEngine:
    @staticmethod
    def ensure_staging_dir() -> str:
        staging_dir = os.path.abspath(settings.BACKUP_TEMP_DIR)
        os.makedirs(staging_dir, exist_ok=True)
        return staging_dir

    @classmethod
    def _build_dump_command(
        cls,
        engine: str,
        db_name: str,
        db_host: str = "127.0.0.1",
        db_port: int = 3306,
        db_user: str = "root",
        db_password: Optional[str] = None,
        os_type: str = "LINUX"
    ) -> str:
        is_windows = os_type.upper() == "WINDOWS"

        if engine in ["MYSQL", "MARIADB"]:
            if is_windows:
                pwd_param = f'-p"{db_password}"' if db_password else ""
                return (
                    f'cmd.exe /c "mysqldump -h {db_host} -P {int(db_port)} -u {db_user} {pwd_param} '
                    f'--single-transaction --quick --quote-names --routines --triggers {db_name}"'
                )
            else:
                pwd_flag = f"-p{shlex.quote(db_password)}" if db_password else ""
                return (
                    f"mysqldump -h {shlex.quote(db_host)} -P {int(db_port)} -u {shlex.quote(db_user)} {pwd_flag} "
                    f"--single-transaction --quick --quote-names --routines --triggers {shlex.quote(db_name)}"
                )
        elif engine == "POSTGRESQL":
            if is_windows:
                env_set = f'set PGPASSWORD={db_password}& ' if db_password else ''
                return (
                    f'cmd.exe /c "{env_set}pg_dump -h {db_host} -p {int(db_port)} -U {db_user} '
                    f'-d {db_name} --clean --if-exists --no-owner --no-privileges"'
                )
            else:
                env_prefix = f"PGPASSWORD={shlex.quote(db_password)} " if db_password else ""
                return (
                    f"{env_prefix}pg_dump -h {shlex.quote(db_host)} -p {int(db_port)} -U {shlex.quote(db_user)} "
                    f"-d {shlex.quote(db_name)} --clean --if-exists --no-owner --no-privileges"
                )
        elif engine == "SQLSERVER":
            server_target = "localhost" if db_host in ["127.0.0.1", "localhost"] else (f"{db_host},{db_port}" if db_port != 1433 else db_host)
            temp_bak = f"C:\\Windows\\Temp\\db_backup_{db_name}_{int(datetime.now().timestamp())}.bak"
            auth_part = f'-U "{db_user}" -P "{db_password}"' if db_password else "-E"
            # Note: -C flag tells ODBC Driver 18 to trust server self-signed certificate
            ps_script = f"""
$bak = '{temp_bak}';
# Try native SQL Server COMPRESSION first for maximum speed and small file size
$sqlComp = "BACKUP DATABASE [{db_name}] TO DISK = '$bak' WITH INIT, COMPRESSION, STATS = 10";
$cmdOut = & sqlcmd -S '{server_target}' {auth_part} -C -Q $sqlComp -b 2>&1;
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $bak)) {{
    # Fallback to standard backup without COMPRESSION if edition does not support it
    $sqlPlain = "BACKUP DATABASE [{db_name}] TO DISK = '$bak' WITH INIT, STATS = 10";
    $cmdOut = & sqlcmd -S '{server_target}' {auth_part} -C -Q $sqlPlain -b 2>&1;
}}
if ($LASTEXITCODE -eq 0 -and (Test-Path $bak)) {{
    $fs = [System.IO.File]::OpenRead($bak);
    $out = [System.Console]::OpenStandardOutput();
    $fs.CopyTo($out);
    $fs.Close();
    $fs.Dispose();
    $out.Flush();
    [System.GC]::Collect();
    [System.GC]::WaitForPendingFinalizers();
    Start-Sleep -Milliseconds 200;
    try {{ Remove-Item -Force $bak; }} catch {{}}
}} else {{
    [Console]::Error.WriteLine($cmdOut);
    exit 1;
}}
"""
            import base64
            b64 = base64.b64encode(ps_script.encode('utf-16le')).decode('ascii')
            return f'powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand {b64}'
        else:
            raise ValueError(f"Motor de base de datos '{engine}' no soportado.")

    @classmethod
    def execute_dump_and_stream(
        cls,
        ssh_client,
        engine: str,
        db_name: str,
        db_host: str = "127.0.0.1",
        db_port: int = 3306,
        db_user: str = "root",
        db_password: Optional[str] = None,
        output_filepath: str = "",
        os_type: str = "LINUX",
        progress_callback: Optional[Callable[[int, str], None]] = None
    ) -> int:
        if progress_callback:
            progress_callback(10, f"Iniciando volcado (dump) de {db_name} en servidor {os_type}...")

        dump_cmd = cls._build_dump_command(
            engine=engine,
            db_name=db_name,
            db_host=db_host,
            db_port=db_port,
            db_user=db_user,
            db_password=db_password,
            os_type=os_type
        )

        stdin, stdout, stderr = ssh_client.exec_command(dump_cmd, bufsize=1024*1024)
        
        bytes_written = 0
        chunk_count = 0
        with gzip.open(output_filepath, 'wb', compresslevel=6) as gz_out:
            while True:
                chunk = stdout.read(1024 * 512)
                if not chunk:
                    break
                gz_out.write(chunk)
                bytes_written += len(chunk)
                chunk_count += 1
                if chunk_count % 20 == 0 and progress_callback:
                    progress_callback(35, f"Comprimiendo y procesando volcado... ({bytes_written // (1024*1024)} MB procesados)")

        exit_status = stdout.channel.recv_exit_status()
        if exit_status != 0:
            err_msg = stderr.read().decode('utf-8', errors='ignore')
            raise RuntimeError(f"Error durante el comando de volcado remoto (código {exit_status}): {err_msg}")

        return bytes_written

    @classmethod
    def run_database_backup(
        cls,
        server,
        database,
        drive_token_json: str,
        root_folder_name: str = "BACKUPS",
        progress_callback: Optional[Callable[[int, str], None]] = None
    ) -> Dict[str, Any]:
        """
        Execute database backup directly to Google Drive.
        The remote dump stream is piped over SSH directly into Google Drive's
        resumable upload endpoint in 8MB in-memory RAM chunks.
        """
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        safe_db_name = database.name.replace(" ", "_")
        filename = f"backup_{server.name}_{safe_db_name}_{timestamp}.sql.gz"

        ssh_client = None
        upload_res = None
        try:
            os_type = getattr(server, 'os_type', 'LINUX') or 'LINUX'
            if progress_callback:
                progress_callback(5, f"Conectando por SSH a {server.name} ({os_type})...")

            from app.core.security import decrypt_secret
            ssh_key = decrypt_secret(server.encrypted_ssh_key)
            ssh_pwd = decrypt_secret(server.encrypted_password)

            ssh_client = SSHService.get_client(
                host=server.host,
                port=server.ssh_port,
                username=server.username,
                private_key_str=ssh_key,
                password=ssh_pwd
            )

            if progress_callback:
                progress_callback(15, "Verificando carpetas de destino en Google Drive...")
            target_folder_id = GoogleDriveService.resolve_backup_folder_path(
                token_json=drive_token_json,
                root_folder_name=root_folder_name,
                server_name=server.name,
                engine=database.engine,
                db_name=database.name
            )

            db_conn = database.connection
            db_pwd = decrypt_secret(db_conn.encrypted_password) if db_conn else None
            db_host = db_conn.host if db_conn else "127.0.0.1"
            db_port = db_conn.port if db_conn else (3306 if database.engine in ["MYSQL", "MARIADB"] else 5432)
            db_user = db_conn.username if db_conn else "root"

            dump_cmd = cls._build_dump_command(
                engine=database.engine,
                db_name=database.name,
                db_host=db_host,
                db_port=db_port,
                db_user=db_user,
                db_password=db_pwd,
                os_type=os_type
            )

            if progress_callback:
                progress_callback(20, f"Iniciando volcado y transmisión en tiempo real de {database.name} a Google Drive...")

            stdin, stdout, stderr = ssh_client.exec_command(dump_cmd, bufsize=1024 * 1024)

            def stream_progress(raw_read: int, comp_sent: int):
                raw_mb = raw_read // (1024 * 1024)
                comp_mb = comp_sent // (1024 * 1024)
                raw_gb = round(raw_read / (1024 ** 3), 2)
                comp_gb = round(comp_sent / (1024 ** 3), 2)
                if progress_callback:
                    db_size = database.size_bytes or 0
                    if db_size > 0:
                        pct = min(int(20 + (raw_read / db_size) * 75), 95)
                    else:
                        pct = 50
                    if raw_gb >= 1.0 or comp_gb >= 1.0:
                        msg = f"Transmitiendo en bloques de 16MB... ({raw_gb} GB leídos, {comp_gb} GB subidos)"
                    else:
                        msg = f"Transmitiendo en bloques de 16MB... ({raw_mb} MB leídos, {comp_mb} MB subidos)"
                    progress_callback(pct, msg)

            upload_res = GoogleDriveService.upload_stream_resumable(
                token_json=drive_token_json,
                stream_reader=stdout,
                destination_folder_id=target_folder_id,
                remote_filename=filename,
                compress=(database.engine != "SQLSERVER"),
                progress_callback=stream_progress
            )

            exit_status = stdout.channel.recv_exit_status()
            if exit_status != 0:
                err_msg = stderr.read().decode('utf-8', errors='ignore')
                try:
                    if upload_res and upload_res.get("id"):
                        GoogleDriveService.delete_file(token_json=drive_token_json, file_id=upload_res["id"])
                except Exception:
                    pass
                raise RuntimeError(f"Error durante el volcado remoto en el servidor (código {exit_status}): {err_msg}")

            if progress_callback:
                progress_callback(98, "Respaldo completado exitosamente en Google Drive.")

            return {
                "file_name": filename,
                "file_size_bytes": upload_res["compressed_size_bytes"],
                "original_db_size_bytes": database.size_bytes or upload_res["raw_size_bytes"],
                "sha256_checksum": upload_res["sha256_checksum"],
                "google_drive_file_id": upload_res["id"],
                "google_drive_path": f"{root_folder_name}/{server.name}/{database.engine}/{database.name}/{filename}"
            }

        finally:
            if ssh_client:
                try:
                    ssh_client.close()
                except Exception:
                    pass
