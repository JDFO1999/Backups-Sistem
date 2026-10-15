import os
import socket
import logging
import subprocess
import concurrent.futures
from datetime import datetime, timezone
import time
from typing import List, Dict, Any, Optional, Tuple
from sqlalchemy.orm import Session
from app.models import Branch
from app.core.config import settings

logger = logging.getLogger(__name__)

class BranchService:
    @staticmethod
    def probe_host(ip: str, port: int = 445, timeout: float = 1.0) -> Tuple[bool, Optional[int]]:
        """
        Quickly check if the host responds on SMB port 445 (or NetBIOS 139)
        and measure network latency in milliseconds.
        """
        if not ip:
            return False, None
        clean_ip = ip.strip()
        t0 = time.perf_counter()
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(timeout)
            result = s.connect_ex((clean_ip, port))
            s.close()
            t_ms = max(1, int((time.perf_counter() - t0) * 1000))
            if result == 0:
                return True, t_ms

            # Fallback to NetBIOS session service (port 139) for older Windows shares
            if port == 445:
                t1 = time.perf_counter()
                s2 = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                s2.settimeout(0.6)
                res2 = s2.connect_ex((clean_ip, 139))
                s2.close()
                t2_ms = max(1, int((time.perf_counter() - t1) * 1000))
                if res2 == 0:
                    return True, t2_ms
            return False, None
        except Exception:
            return False, None


    @classmethod
    def sync_branches_from_sql_server(cls, db: Session) -> Dict[str, Any]:
        """
        Query Sistemas.dbo.Sucursal from SQL Server and synchronize Branch records.
        """
        host = settings.SQLSERVER_BRANCH_HOST
        user = settings.SQLSERVER_BRANCH_USER
        pwd = settings.SQLSERVER_BRANCH_PASSWORD
        database = settings.SQLSERVER_BRANCH_DATABASE

        query = (
            "SET NOCOUNT ON; "
            "SELECT idSucursal, RTRIM(cCodigo) AS cCodigo, RTRIM(cNombre) AS cNombre, "
            "CAST(lInactiva AS INT) AS lInactiva, RTRIM(cRutaIP) AS cRutaIP "
            "FROM Sucursal ORDER BY idSucursal;"
        )

        cmd = [
            "sqlcmd",
            "-S", host,
            "-U", user,
            "-P", pwd,
            "-d", database,
            "-s", "|",
            "-W",
            "-Q", query
        ]

        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
            if res.returncode != 0:
                raise RuntimeError(f"Error ejecutando sqlcmd: {res.stderr}")
        except Exception as e:
            logger.error(f"Fallo conectando a SQL Server para Sucursal: {e}")
            raise

        lines = [line.strip() for line in res.stdout.splitlines() if line.strip()]
        if len(lines) < 2:
            return {"synced": 0, "message": "No se encontraron sucursales."}

        # First line is header, second is separator (-------|-------)
        data_lines = lines[2:]

        branches_data = []
        for line in data_lines:
            parts = line.split("|")
            if len(parts) >= 5:
                id_suc = parts[0].strip()
                code = parts[1].strip()
                name = parts[2].strip()
                inactiva = parts[3].strip() == "1"
                ip = parts[4].strip()
                if code and ip:
                    unc = f"\\\\{ip}\\Sistema\\aBC-Soft"
                    branches_data.append({
                        "code": code,
                        "name": name,
                        "ip": ip,
                        "unc_path": unc,
                        "is_active": not inactiva
                    })

        # Check online status and latency in parallel
        def check_status(item):
            online, lat = cls.probe_host(item["ip"])
            return item["code"], online, lat

        online_map = {}
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
            for code, online, lat in executor.map(check_status, branches_data):
                online_map[code] = (online, lat)

        created_count = 0
        updated_count = 0
        now = datetime.now(timezone.utc)

        for item in branches_data:
            code = item["code"]
            branch = db.query(Branch).filter(Branch.code == code).first()
            is_online, lat_ms = online_map.get(code, (False, None))

            if not branch:
                branch = Branch(
                    code=code,
                    name=item["name"],
                    ip_address=item["ip"],
                    unc_path=item["unc_path"],
                    is_active=item["is_active"],
                    is_online=is_online,
                    latency_ms=lat_ms,
                    last_checked_at=now
                )
                db.add(branch)
                created_count += 1
            else:
                branch.name = item["name"]
                branch.ip_address = item["ip"]
                branch.unc_path = item["unc_path"]
                branch.is_active = item["is_active"]
                branch.is_online = is_online
                branch.latency_ms = lat_ms
                branch.last_checked_at = now
                updated_count += 1

        db.commit()

        return {
            "total": len(branches_data),
            "created": created_count,
            "updated": updated_count,
            "online_count": sum(1 for v in online_map.values() if v[0])
        }

    @classmethod
    def check_all_branches_heartbeat(cls, db: Session) -> List[Branch]:
        """
        Performs parallel heartbeat & latency checks across all active branches.
        Updates is_online, latency_ms and last_checked_at in database.
        """
        branches = db.query(Branch).order_by(Branch.code.asc()).all()
        if not branches:
            return []

        now = datetime.now(timezone.utc)
        def probe_single(b: Branch):
            online, lat = cls.probe_host(b.ip_address)
            return b.id, online, lat

        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
            futures = [executor.submit(probe_single, b) for b in branches]
            results = [f.result() for f in concurrent.futures.as_completed(futures)]

        res_map = {bid: (onl, lat) for bid, onl, lat in results}
        for b in branches:
            if b.id in res_map:
                onl, lat = res_map[b.id]
                b.is_online = onl
                b.latency_ms = lat if onl else None
                b.last_checked_at = now

        db.commit()
        return branches

    @classmethod
    def get_branches(cls, db: Session, refresh_online: bool = False) -> List[Branch]:
        if refresh_online:
            return cls.check_all_branches_heartbeat(db)
        return db.query(Branch).order_by(Branch.code.asc()).all()


    @classmethod
    def get_branch_subfolders(cls, unc_path: str) -> List[Dict[str, Any]]:
        """List top-level directories in UNC path with file counts if reachable"""
        if not os.path.exists(unc_path):
            return []
        subfolders = []
        try:
            with os.scandir(unc_path) as it:
                for entry in it:
                    if entry.is_dir():
                        subfolders.append({
                            "name": entry.name,
                            "path": entry.path
                        })
        except Exception as e:
            logger.warning(f"No se pudieron listar subcarpetas de {unc_path}: {e}")
        return sorted(subfolders, key=lambda x: x["name"].lower())
