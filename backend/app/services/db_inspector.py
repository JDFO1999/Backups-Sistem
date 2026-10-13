import re
import shlex
import logging
from typing import List, Dict, Any, Optional
from app.services.ssh_service import SSHService

logger = logging.getLogger(__name__)

class DatabaseInspector:
    @staticmethod
    def _validate_identifier(name: str) -> bool:
        return bool(re.match(r'^[a-zA-Z0-9_\-]+$', name))

    @classmethod
    def inspect_mysql(
        cls,
        ssh_host: str,
        ssh_port: int,
        ssh_user: str,
        ssh_key: Optional[str],
        ssh_password: Optional[str],
        db_host: str = "127.0.0.1",
        db_port: int = 3306,
        db_user: str = "root",
        db_password: Optional[str] = None,
        os_type: str = "LINUX"
    ) -> List[Dict[str, Any]]:
        client = None
        databases = []
        try:
            client = SSHService.get_client(ssh_host, ssh_port, ssh_user, ssh_key, ssh_password)
            
            pwd_flag = f"-p{shlex.quote(db_password)}" if db_password else ""
            sql = (
                "SELECT table_schema, COALESCE(SUM(data_length + index_length), 0) "
                "FROM information_schema.tables "
                "WHERE table_schema NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys') "
                "GROUP BY table_schema;"
            )
            
            if os_type.upper() == "WINDOWS":
                # Windows command syntax
                pwd_param = f'-p"{db_password}"' if db_password else ""
                cmd = f'cmd.exe /c "mysql -h {db_host} -P {int(db_port)} -u {db_user} {pwd_param} -s -N -e \\"{sql}\\""'
            else:
                cmd = f"mysql -h {shlex.quote(db_host)} -P {int(db_port)} -u {shlex.quote(db_user)} {pwd_flag} -s -N -e {shlex.quote(sql)}"

            stdin, stdout, stderr = client.exec_command(cmd, timeout=15)
            lines = stdout.read().decode('utf-8', errors='ignore').splitlines()

            for line in lines:
                parts = line.strip().split()
                if len(parts) >= 2:
                    db_name = parts[0]
                    try:
                        size_bytes = int(parts[1])
                    except ValueError:
                        size_bytes = 0
                    databases.append({
                        "name": db_name,
                        "engine": "MYSQL",
                        "size_bytes": size_bytes
                    })

        except Exception as e:
            logger.error(f"Error inspeccionando MySQL remoto: {e}")
        finally:
            if client:
                client.close()

        return databases

    @classmethod
    def inspect_postgres(
        cls,
        ssh_host: str,
        ssh_port: int,
        ssh_user: str,
        ssh_key: Optional[str],
        ssh_password: Optional[str],
        db_host: str = "127.0.0.1",
        db_port: int = 5432,
        db_user: str = "postgres",
        db_password: Optional[str] = None,
        os_type: str = "LINUX"
    ) -> List[Dict[str, Any]]:
        client = None
        databases = []
        try:
            client = SSHService.get_client(ssh_host, ssh_port, ssh_user, ssh_key, ssh_password)

            sql = "SELECT datname, pg_database_size(datname) FROM pg_database WHERE datistemplate = false;"
            
            if os_type.upper() == "WINDOWS":
                env_set = f'set PGPASSWORD={db_password}& ' if db_password else ''
                cmd = f'cmd.exe /c "{env_set}psql -h {db_host} -p {int(db_port)} -U {db_user} -t -A -F , -c \\"{sql}\\""'
            else:
                env_prefix = f"PGPASSWORD={shlex.quote(db_password)} " if db_password else ""
                cmd = f"{env_prefix}psql -h {shlex.quote(db_host)} -p {int(db_port)} -U {shlex.quote(db_user)} -t -A -F ',' -c {shlex.quote(sql)}"

            stdin, stdout, stderr = client.exec_command(cmd, timeout=15)
            lines = stdout.read().decode('utf-8', errors='ignore').splitlines()

            for line in lines:
                parts = line.strip().split(',')
                if len(parts) >= 2:
                    db_name = parts[0].strip()
                    try:
                        size_bytes = int(parts[1].strip())
                    except ValueError:
                        size_bytes = 0
                    databases.append({
                        "name": db_name,
                        "engine": "POSTGRESQL",
                        "size_bytes": size_bytes
                    })

        except Exception as e:
            logger.error(f"Error inspeccionando PostgreSQL remoto: {e}")
        finally:
            if client:
                client.close()

        return databases

    @classmethod
    def inspect_sqlserver(
        cls,
        ssh_host: str,
        ssh_port: int,
        ssh_user: str,
        ssh_key: Optional[str],
        ssh_password: Optional[str],
        db_host: str = "127.0.0.1",
        db_port: int = 1433,
        db_user: str = "sa",
        db_password: Optional[str] = None,
        os_type: str = "WINDOWS"
    ) -> List[Dict[str, Any]]:
        client = None
        databases = []
        try:
            client = SSHService.get_client(ssh_host, ssh_port, ssh_user, ssh_key, ssh_password)

            # Query SQL Server sys.master_files to get total database size in bytes (size * 8192 bytes per 8KB page)
            # Excluding system databases: master, tempdb, model, msdb
            sql_query = (
                "SET NOCOUNT ON; "
                "SELECT d.name + '|' + CAST(COALESCE(SUM(CAST(mf.size AS BIGINT) * 8192), 0) AS VARCHAR(50)) "
                "FROM sys.databases d "
                "LEFT JOIN sys.master_files mf ON d.database_id = mf.database_id "
                "WHERE d.name NOT IN ('master', 'tempdb', 'model', 'msdb') "
                "GROUP BY d.name;"
            )

            server_target = "localhost" if db_host in ["127.0.0.1", "localhost"] else (f"{db_host},{db_port}" if db_port != 1433 else db_host)
            
            # Robust PowerShell script with System.Data.SqlClient (100% reliable on Windows)
            # Support both SQL Auth and Integrated Security
            auth_clause = f"User Id={db_user};Password={db_password};" if (db_user and db_password and db_user.lower() != 'sa' and db_password) or (db_password) else "Integrated Security=True;"
            
            ps_script = f"""
$sql = "SET NOCOUNT ON; SELECT d.name + '|' + CAST(COALESCE(SUM(CAST(mf.size AS BIGINT) * 8192), 0) AS VARCHAR(50)) FROM sys.databases d LEFT JOIN sys.master_files mf ON d.database_id = mf.database_id WHERE d.name NOT IN ('master', 'tempdb', 'model', 'msdb') GROUP BY d.name;"
try {{
    $connStr = "Server={server_target};Database=master;{auth_clause}"
    $conn = New-Object System.Data.SqlClient.SqlConnection($connStr)
    $conn.Open()
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = $sql
    $r = $cmd.ExecuteReader()
    while ($r.Read()) {{
        Write-Output $r.GetString(0)
    }}
    $conn.Close()
}} catch {{
    # Fallback to sqlcmd if ODBC/SqlClient threw error
    try {{
        $auth = if ('{db_password}') {{ "-U '{db_user}' -P '{db_password}'" }} else {{ "-E" }}
        $out = Invoke-Expression "sqlcmd -S '{server_target}' $auth -Q `"$sql`" -h -1 -W"
        $out
    }} catch {{
        Write-Error $_.Exception.Message
    }}
}}
"""
            import base64
            b64_cmd = base64.b64encode(ps_script.encode('utf-16le')).decode('ascii')
            cmd = f'powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand {b64_cmd}'
            stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
            lines = stdout.read().decode('utf-8', errors='ignore').splitlines()

            for line in lines:
                line_str = line.strip()
                if '|' in line_str:
                    parts = line_str.split('|')
                    if len(parts) >= 2:
                        db_name = parts[0].strip()
                        try:
                            size_bytes = int(parts[1].strip())
                        except ValueError:
                            size_bytes = 0
                        databases.append({
                            "name": db_name,
                            "engine": "SQLSERVER",
                            "size_bytes": size_bytes
                        })

        except Exception as e:
            logger.error(f"Error inspeccionando SQL Server remoto: {e}")
        finally:
            if client:
                client.close()

        return databases

