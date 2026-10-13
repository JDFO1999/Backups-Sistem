import os
import gzip
import shutil
import base64
import logging
from datetime import datetime, timezone
from typing import Optional
from app.core.config import settings
from app.core.database import SessionLocal
from app.models import RestoreJob, BackupFile, Database, Server, GoogleDriveAccount
from app.services.ssh_service import SSHService
from app.services.google_drive_service import GoogleDriveService
from app.core.security import decrypt_secret
from app.utils.formatters import calculate_sha256

logger = logging.getLogger(__name__)

class RestoreEngine:
    @staticmethod
    def ensure_staging_dir() -> str:
        staging_dir = os.path.abspath(settings.BACKUP_TEMP_DIR)
        os.makedirs(staging_dir, exist_ok=True)
        return staging_dir

    @classmethod
    def run_database_restore(cls, restore_job_id: int) -> None:
        db = SessionLocal()
        staging_dir = cls.ensure_staging_dir()
        compressed_local_path = None
        uncompressed_local_path = None
        ssh_client = None
        job = None

        try:
            job = db.query(RestoreJob).filter(RestoreJob.id == restore_job_id).first()
            if not job:
                logger.error(f"RestoreJob #{restore_job_id} no encontrado.")
                return

            backup_file = job.backup_file
            if not backup_file:
                raise ValueError("Archivo de respaldo asociado no encontrado.")

            target_server = job.target_server
            if not target_server:
                raise ValueError("Servidor destino no encontrado.")

            drive_account = db.query(GoogleDriveAccount).filter(GoogleDriveAccount.is_active == True).first()
            if not drive_account or not drive_account.encrypted_token_json:
                raise ValueError("No hay una cuenta activa de Google Drive configurada.")

            token_json = decrypt_secret(drive_account.encrypted_token_json)
            if not token_json:
                raise ValueError("No se pudieron descifrar las credenciales de Google Drive.")

            job.status = "RUNNING"
            job.started_at = datetime.now(timezone.utc)
            job.progress_percent = 5
            job.current_step = "Iniciando descarga desde Google Drive..."
            db.commit()

            # 1. Download file from Google Drive
            compressed_filename = f"restore_{job.id}_{backup_file.file_name}"
            compressed_local_path = os.path.join(staging_dir, compressed_filename)

            def dl_progress(pct: int):
                try:
                    job.progress_percent = min(int(5 + (pct * 0.35)), 40)
                    job.current_step = f"Descargando de Google Drive ({pct}%)..."
                    db.commit()
                except Exception:
                    pass

            GoogleDriveService.download_file(
                token_json=token_json,
                file_id=backup_file.google_drive_file_id,
                destination_path=compressed_local_path,
                progress_callback=dl_progress
            )

            # 2. Check SHA-256 integrity
            job.progress_percent = 42
            job.current_step = "Verificando suma de comprobación SHA-256..."
            db.commit()

            downloaded_hash = calculate_sha256(compressed_local_path)
            if backup_file.sha256_checksum and downloaded_hash.lower() != backup_file.sha256_checksum.lower():
                raise ValueError(
                    f"Integridad comprometida: El checksum descargado no coincide con el registrado "
                    f"({downloaded_hash[:16]}... vs {backup_file.sha256_checksum[:16]}...)."
                )

            # 3. Decompress file
            job.progress_percent = 48
            job.current_step = "Descomprimiendo archivo de respaldo..."
            db.commit()

            orig_engine = (backup_file.database.engine if backup_file.database else "SQLSERVER").upper()
            is_sqlserver = orig_engine == "SQLSERVER"
            uncompressed_ext = ".bak" if is_sqlserver else ".sql"
            uncompressed_filename = f"restore_{job.id}_data{uncompressed_ext}"
            uncompressed_local_path = os.path.join(staging_dir, uncompressed_filename)

            with gzip.open(compressed_local_path, 'rb') as gz_in, open(uncompressed_local_path, 'wb') as f_out:
                shutil.copyfileobj(gz_in, f_out, length=1024*1024)

            # Remove compressed local file immediately to free disk space
            if os.path.exists(compressed_local_path):
                try:
                    os.remove(compressed_local_path)
                    compressed_local_path = None
                except Exception:
                    pass

            # 4. Connect to target server via SSH
            job.progress_percent = 55
            job.current_step = f"Conectando por SSH a {target_server.name}..."
            db.commit()

            ssh_key = decrypt_secret(target_server.encrypted_ssh_key)
            ssh_pwd = decrypt_secret(target_server.encrypted_password)

            ssh_client = SSHService.get_client(
                host=target_server.host,
                port=target_server.ssh_port,
                username=target_server.username,
                private_key_str=ssh_key,
                password=ssh_pwd
            )

            target_db_name = job.target_database_name.strip()

            # 5. Restore based on engine
            if is_sqlserver:
                cls._restore_sqlserver(
                    job=job,
                    db=db,
                    ssh_client=ssh_client,
                    target_server=target_server,
                    uncompressed_local_path=uncompressed_local_path,
                    target_db_name=target_db_name,
                    overwrite=job.overwrite
                )
            elif orig_engine in ["MYSQL", "MARIADB"]:
                cls._restore_mysql(
                    job=job,
                    db=db,
                    ssh_client=ssh_client,
                    target_server=target_server,
                    uncompressed_local_path=uncompressed_local_path,
                    target_db_name=target_db_name,
                    overwrite=job.overwrite
                )
            elif orig_engine == "POSTGRESQL":
                cls._restore_postgres(
                    job=job,
                    db=db,
                    ssh_client=ssh_client,
                    target_server=target_server,
                    uncompressed_local_path=uncompressed_local_path,
                    target_db_name=target_db_name,
                    overwrite=job.overwrite
                )
            else:
                raise ValueError(f"Motor '{orig_engine}' no soportado para restauración automática.")

            # 6. Synchronize inventory in DB Manager
            existing_db = db.query(Database).filter(
                Database.server_id == target_server.id,
                Database.name == target_db_name
            ).first()

            if not existing_db:
                new_db = Database(
                    server_id=target_server.id,
                    name=target_db_name,
                    engine=orig_engine,
                    size_bytes=backup_file.original_db_size_bytes or 0,
                    last_backup_status="RESTORED"
                )
                db.add(new_db)
            else:
                existing_db.last_backup_status = "RESTORED"

            job.status = "COMPLETED"
            job.progress_percent = 100
            job.current_step = f"Base de datos '{target_db_name}' restaurada exitosamente."
            job.finished_at = datetime.now(timezone.utc)
            db.commit()

        except Exception as e:
            logger.error(f"Error restaurando base de datos en job #{restore_job_id}: {e}", exc_info=True)
            if job:
                job.status = "FAILED"
                job.error_message = str(e)
                job.current_step = f"Error: {str(e)[:250]}"
                job.finished_at = datetime.now(timezone.utc)
                db.commit()
        finally:
            if ssh_client:
                try:
                    ssh_client.close()
                except Exception:
                    pass
            for p in [compressed_local_path, uncompressed_local_path]:
                if p and os.path.exists(p):
                    try:
                        os.remove(p)
                    except Exception:
                        pass
            db.close()

    @classmethod
    def _restore_sqlserver(
        cls,
        job: RestoreJob,
        db,
        ssh_client,
        target_server: Server,
        uncompressed_local_path: str,
        target_db_name: str,
        overwrite: bool
    ) -> None:
        job.progress_percent = 60
        job.current_step = "Transfiriendo archivo .bak al servidor Windows..."
        db.commit()

        remote_bak = f"C:\\Windows\\Temp\\db_restore_{job.id}_{int(datetime.now().timestamp())}.bak"
        file_size = os.path.getsize(uncompressed_local_path)

        # Upload via SFTP with live progress
        sftp = ssh_client.open_sftp()
        try:
            def sftp_cb(transferred: int, total: int):
                if total > 0:
                    pct = int((transferred / total) * 100)
                    job.progress_percent = min(int(60 + (pct * 0.18)), 78)
                    job.current_step = f"Transfiriendo .bak al servidor ({pct}%)..."
                    db.commit()

            sftp.put(uncompressed_local_path, remote_bak, callback=sftp_cb)
        finally:
            sftp.close()

        job.progress_percent = 80
        job.current_step = f"Ejecutando restauración de SQL Server en base de datos '{target_db_name}'..."
        db.commit()

        # Database connection details if available
        conn = target_server.database_connections[0] if target_server.database_connections else None
        db_host = conn.host if conn else "127.0.0.1"
        db_port = conn.port if conn else 1433
        db_user = conn.username if conn else "sa"
        db_pwd = decrypt_secret(conn.encrypted_password) if conn and conn.encrypted_password else None

        server_target = "localhost" if db_host in ["127.0.0.1", "localhost"] else (f"{db_host},{db_port}" if db_port != 1433 else db_host)
        auth_conn = f"User Id={db_user};Password={db_pwd};" if (db_user and db_pwd and db_user.lower() != 'sa' and db_pwd) or (db_pwd) else "Integrated Security=True;"
        auth_cmd = f'-U "{db_user}" -P "{db_pwd}"' if db_pwd else "-E"

        ps_script = f"""
$bak = '{remote_bak}';
$targetDb = '{target_db_name}';
$serverTarget = '{server_target}';
$overwrite = {1 if overwrite else 0};

try {{
    $connStr = "Server=$serverTarget;Database=master;{auth_conn}TrustServerCertificate=True;";
    $conn = New-Object System.Data.SqlClient.SqlConnection($connStr);
    $conn.Open();

    # 1. Verify existence
    $cmd = $conn.CreateCommand();
    $cmd.CommandText = "SELECT COUNT(*) FROM sys.databases WHERE name = @name";
    $p = $cmd.Parameters.Add("@name", [System.Data.SqlDbType]::NVarChar, 128);
    $p.Value = $targetDb;
    $existsCount = [int]$cmd.ExecuteScalar();

    if ($existsCount -gt 0 -and $overwrite -eq 0) {{
        throw "La base de datos '$targetDb' ya existe en el servidor. Marque la casilla 'Sobrescribir' para reemplazarla.";
    }}

    # 2. Get default data/log directories
    $dirCmd = $conn.CreateCommand();
    $dirCmd.CommandText = @"
    SET NOCOUNT ON;
    DECLARE @DataPath NVARCHAR(512) = CAST(SERVERPROPERTY('InstanceDefaultDataPath') AS NVARCHAR(512));
    DECLARE @LogPath NVARCHAR(512) = CAST(SERVERPROPERTY('InstanceDefaultLogPath') AS NVARCHAR(512));
    IF @DataPath IS NULL
        SELECT TOP 1 @DataPath = SUBSTRING(physical_name, 1, LEN(physical_name) - CHARINDEX('\', REVERSE(physical_name)) + 1) FROM sys.master_files WHERE type_desc = 'ROWS';
    IF @LogPath IS NULL
        SELECT TOP 1 @LogPath = SUBSTRING(physical_name, 1, LEN(physical_name) - CHARINDEX('\', REVERSE(physical_name)) + 1) FROM sys.master_files WHERE type_desc = 'LOG';
    SELECT ISNULL(@DataPath, 'C:\Program Files\Microsoft SQL Server\MSSQL15.MSSQLSERVER\MSSQL\DATA\') + '|' + ISNULL(@LogPath, 'C:\Program Files\Microsoft SQL Server\MSSQL15.MSSQLSERVER\MSSQL\DATA\');
"@;
    $dirStr = [string]$dirCmd.ExecuteScalar();
    $dataDir = "C:\Program Files\Microsoft SQL Server\MSSQL15.MSSQLSERVER\MSSQL\DATA\";
    $logDir = "C:\Program Files\Microsoft SQL Server\MSSQL15.MSSQLSERVER\MSSQL\DATA\";
    if ($dirStr -match '^(.*?)\|(.*?)$') {{
        $dataDir = $matches[1].Trim();
        $logDir = $matches[2].Trim();
        if (-not $dataDir.EndsWith('\')) {{ $dataDir += '\' }}
        if (-not $logDir.EndsWith('\')) {{ $logDir += '\' }}
    }}

    # 3. Read logical files from .bak
    $flCmd = $conn.CreateCommand();
    $flCmd.CommandText = "RESTORE FILELISTONLY FROM DISK = '$bak'";
    $da = New-Object System.Data.SqlClient.SqlDataAdapter($flCmd);
    $dt = New-Object System.Data.DataTable;
    $da.Fill($dt) | Out-Null;

    $moveClauses = @();
    $dataIdx = 0;
    $logIdx = 0;
    foreach ($row in $dt.Rows) {{
        $lName = $row["LogicalName"];
        $lType = $row["Type"];
        if ($lType -eq "D") {{
            $suf = if ($dataIdx -eq 0) {{ ".mdf" }} else {{ "_$dataIdx.ndf" }};
            $dest = "$dataDir$targetDb$suf";
            $moveClauses += "MOVE '$lName' TO '$dest'";
            $dataIdx++;
        }} elseif ($lType -eq "L") {{
            $suf = if ($logIdx -eq 0) {{ "_log.ldf" }} else {{ "_log_$logIdx.ldf" }};
            $dest = "$logDir$targetDb$suf";
            $moveClauses += "MOVE '$lName' TO '$dest'";
            $logIdx++;
        }}
    }}
    $moveSql = if ($moveClauses.Count -gt 0) {{ ($moveClauses -join ", ") + ", " }} else {{ "" }};

    # 4. If existing, force single-user
    if ($existsCount -gt 0) {{
        $kickCmd = $conn.CreateCommand();
        $kickCmd.CommandText = "ALTER DATABASE [$targetDb] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;";
        $kickCmd.ExecuteNonQuery() | Out-Null;
    }}

    # 5. Restore database
    $restoreCmd = $conn.CreateCommand();
    $restoreCmd.CommandTimeout = 1800;
    $restoreCmd.CommandText = "RESTORE DATABASE [$targetDb] FROM DISK = '$bak' WITH $moveSql REPLACE, STATS = 10;";
    $restoreCmd.ExecuteNonQuery() | Out-Null;

    # 6. Re-enable multi-user
    $multiCmd = $conn.CreateCommand();
    $multiCmd.CommandText = "ALTER DATABASE [$targetDb] SET MULTI_USER;";
    $multiCmd.ExecuteNonQuery() | Out-Null;

    $conn.Close();
    Write-Output "RESTORATION_SUCCESS";
}} catch {{
    Write-Error $_.Exception.Message;
    exit 1;
}} finally {{
    if ($conn) {{
        try {{ $conn.Close(); $conn.Dispose(); }} catch {{}}
    }}
    [System.GC]::Collect();
    [System.GC]::WaitForPendingFinalizers();
    Start-Sleep -Milliseconds 300;
    try {{ Remove-Item -Force $bak; }} catch {{}}
}}
"""
        b64 = base64.b64encode(ps_script.encode('utf-16le')).decode('ascii')
        cmd = f'powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand {b64}'
        stdin, stdout, stderr = ssh_client.exec_command(cmd, timeout=1800)

        out = stdout.read().decode('utf-8', errors='ignore')
        err = stderr.read().decode('utf-8', errors='ignore')
        exit_code = stdout.channel.recv_exit_status()

        if exit_code != 0:
            raise RuntimeError(f"Fallo en restauración de SQL Server (código {exit_code}): {err or out}")

    @classmethod
    def _restore_mysql(
        cls,
        job: RestoreJob,
        db,
        ssh_client,
        target_server: Server,
        uncompressed_local_path: str,
        target_db_name: str,
        overwrite: bool
    ) -> None:
        conn = target_server.database_connections[0] if target_server.database_connections else None
        db_host = conn.host if conn else "127.0.0.1"
        db_port = conn.port if conn else 3306
        db_user = conn.username if conn else "root"
        db_pwd = decrypt_secret(conn.encrypted_password) if conn and conn.encrypted_password else None

        pwd_flag = f"-p{db_pwd}" if db_pwd else ""

        # Create DB if not exists
        create_sql = f"CREATE DATABASE IF NOT EXISTS `{target_db_name}`;"
        ssh_client.exec_command(f'mysql -h {db_host} -P {int(db_port)} -u {db_user} {pwd_flag} -e "{create_sql}"')

        # Stream SQL
        job.progress_percent = 70
        job.current_step = f"Cargando script SQL a MySQL en base de datos '{target_db_name}'..."
        db.commit()

        restore_cmd = f"mysql -h {db_host} -P {int(db_port)} -u {db_user} {pwd_flag} {target_db_name}"
        stdin, stdout, stderr = ssh_client.exec_command(restore_cmd)

        with open(uncompressed_local_path, 'rb') as f:
            while chunk := f.read(1024 * 512):
                stdin.write(chunk)
        stdin.close()

        exit_code = stdout.channel.recv_exit_status()
        if exit_code != 0:
            err = stderr.read().decode('utf-8', errors='ignore')
            raise RuntimeError(f"Fallo en restauración MySQL (código {exit_code}): {err}")

    @classmethod
    def _restore_postgres(
        cls,
        job: RestoreJob,
        db,
        ssh_client,
        target_server: Server,
        uncompressed_local_path: str,
        target_db_name: str,
        overwrite: bool
    ) -> None:
        conn = target_server.database_connections[0] if target_server.database_connections else None
        db_host = conn.host if conn else "127.0.0.1"
        db_port = conn.port if conn else 5432
        db_user = conn.username if conn else "postgres"
        db_pwd = decrypt_secret(conn.encrypted_password) if conn and conn.encrypted_password else None

        env_prefix = f"PGPASSWORD='{db_pwd}' " if db_pwd else ""

        # Create DB if not exists
        create_cmd = f'{env_prefix}psql -h {db_host} -p {int(db_port)} -U {db_user} -d postgres -c "CREATE DATABASE \\"{target_db_name}\\";"'
        ssh_client.exec_command(create_cmd)

        job.progress_percent = 70
        job.current_step = f"Cargando script SQL a PostgreSQL en base de datos '{target_db_name}'..."
        db.commit()

        restore_cmd = f'{env_prefix}psql -h {db_host} -p {int(db_port)} -U {db_user} -d {target_db_name}'
        stdin, stdout, stderr = ssh_client.exec_command(restore_cmd)

        with open(uncompressed_local_path, 'rb') as f:
            while chunk := f.read(1024 * 512):
                stdin.write(chunk)
        stdin.close()

        exit_code = stdout.channel.recv_exit_status()
        if exit_code != 0:
            err = stderr.read().decode('utf-8', errors='ignore')
            raise RuntimeError(f"Fallo en restauración PostgreSQL (código {exit_code}): {err}")
