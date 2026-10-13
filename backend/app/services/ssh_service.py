import io
import time
import logging
from typing import Dict, Any, Tuple, Optional
import paramiko

logger = logging.getLogger(__name__)

class SSHService:
    @staticmethod
    def get_client(
        host: str,
        port: int = 22,
        username: str = "root",
        private_key_str: Optional[str] = None,
        password: Optional[str] = None,
        timeout: int = 10
    ) -> paramiko.SSHClient:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

        pkey = None
        if private_key_str:
            key_file = io.StringIO(private_key_str.strip())
            for key_class in [paramiko.RSAKey, paramiko.Ed25519Key, paramiko.ECDSAKey]:
                try:
                    key_file.seek(0)
                    pkey = key_class.from_private_key(key_file)
                    break
                except Exception:
                    continue

        last_err = None
        for attempt in range(2):
            try:
                client.connect(
                    hostname=host,
                    port=port,
                    username=username,
                    pkey=pkey,
                    password=password if not pkey else None,
                    timeout=timeout,
                    banner_timeout=30,
                    auth_timeout=30,
                    allow_agent=False,
                    look_for_keys=False
                )
                return client
            except Exception as e:
                last_err = e
                time.sleep(1)
        if last_err:
            raise last_err
        return client

    @classmethod
    def test_connection(
        cls,
        host: str,
        port: int = 22,
        username: str = "root",
        private_key_str: Optional[str] = None,
        password: Optional[str] = None,
        os_type: str = "LINUX"
    ) -> Tuple[bool, float, str, str]:
        start = time.time()
        client = None
        try:
            client = cls.get_client(
                host=host,
                port=port,
                username=username,
                private_key_str=private_key_str,
                password=password,
                timeout=8
            )
            latency = (time.time() - start) * 1000

            if os_type.upper() == "WINDOWS":
                # Detect Windows OS info via cmd or powershell
                stdin, stdout, stderr = client.exec_command(
                    'cmd.exe /c "ver" 2>nul || powershell -Command "[System.Environment]::OSVersion.VersionString"', 
                    timeout=6
                )
                win_output = stdout.read().decode('utf-8', errors='ignore').strip()
                detected_os = win_output if win_output else "Windows Server (Remote SSH)"
                return True, round(latency, 2), detected_os, "Conexión SSH a servidor Windows exitosa."
            else:
                # Detect Linux Distro
                stdin, stdout, stderr = client.exec_command("uname -s -r -m", timeout=5)
                uname_output = stdout.read().decode('utf-8', errors='ignore').strip()
                
                stdin, stdout, stderr = client.exec_command("cat /etc/os-release | grep PRETTY_NAME", timeout=5)
                os_line = stdout.read().decode('utf-8', errors='ignore').strip()
                if os_line and "PRETTY_NAME=" in os_line:
                    distro = os_line.replace('PRETTY_NAME=', '').strip('"\'')
                    detected_os = f"{distro} ({uname_output})"
                else:
                    detected_os = uname_output or "Linux"

                return True, round(latency, 2), detected_os, "Conexión SSH a servidor Linux exitosa."

        except paramiko.AuthenticationException:
            return False, 0.0, "", "Error de autenticación SSH: Usuario, contraseña o llave privada incorrecta."
        except Exception as e:
            return False, 0.0, "", f"Error de conexión SSH: {str(e)}"
        finally:
            if client:
                client.close()

    @classmethod
    def detect_database_engines(
        cls,
        host: str,
        port: int = 22,
        username: str = "root",
        private_key_str: Optional[str] = None,
        password: Optional[str] = None,
        os_type: str = "LINUX"
    ) -> Dict[str, Any]:
        detected = {
            "has_mysql": False,
            "has_mariadb": False,
            "has_postgres": False,
            "mysql_client_path": None,
            "pg_client_path": None,
            "running_services": []
        }
        client = None
        try:
            client = cls.get_client(host, port, username, private_key_str, password)

            if os_type.upper() == "WINDOWS":
                # Check Windows paths
                _, stdout, _ = client.exec_command('cmd.exe /c "where mysqldump & where mariadb-dump & where pg_dump"')
                paths = stdout.read().decode('utf-8', errors='ignore').splitlines()
                for p in paths:
                    p_lower = p.lower()
                    if "mysqldump" in p_lower:
                        detected["has_mysql"] = True
                        detected["mysql_client_path"] = p.strip()
                    if "mariadb" in p_lower:
                        detected["has_mariadb"] = True
                    if "pg_dump" in p_lower:
                        detected["has_postgres"] = True
                        detected["pg_client_path"] = p.strip()

                # Check active ports on Windows
                _, stdout, _ = client.exec_command('netstat -ano | findstr "LISTENING"')
                ports_output = stdout.read().decode('utf-8', errors='ignore')
                if ":3306" in ports_output:
                    detected["running_services"].append("MySQL/MariaDB (Puerto 3306)")
                if ":5432" in ports_output:
                    detected["running_services"].append("PostgreSQL (Puerto 5432)")
            else:
                # Linux check
                _, stdout, _ = client.exec_command("which mysqldump mariadb-dump pg_dump")
                paths = stdout.read().decode('utf-8', errors='ignore').splitlines()
                for p in paths:
                    if "mysqldump" in p:
                        detected["has_mysql"] = True
                        detected["mysql_client_path"] = p
                    if "mariadb-dump" in p:
                        detected["has_mariadb"] = True
                    if "pg_dump" in p:
                        detected["has_postgres"] = True
                        detected["pg_client_path"] = p

                _, stdout, _ = client.exec_command("ss -tuln 2>/dev/null || netstat -tuln 2>/dev/null")
                ports_output = stdout.read().decode('utf-8', errors='ignore')
                if ":3306" in ports_output:
                    detected["running_services"].append("MySQL/MariaDB (Puerto 3306)")
                if ":5432" in ports_output:
                    detected["running_services"].append("PostgreSQL (Puerto 5432)")

        except Exception as e:
            logger.error(f"Error detectando motores de BD vía SSH: {e}")
        finally:
            if client:
                client.close()

        return detected
