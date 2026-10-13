from app.core.database import SessionLocal
from app.models import Server
from app.services.ssh_service import SSHService
from app.core.security import decrypt_secret
import base64

db = SessionLocal()
s = db.query(Server).filter(Server.id == 1).first()
key = decrypt_secret(s.encrypted_ssh_key)
pwd = decrypt_secret(s.encrypted_password)
client = SSHService.get_client(s.host, s.ssh_port, s.username, key, pwd)

ps = """
Get-PSDrive -PSProvider FileSystem | ForEach-Object {
    [PSCustomObject]@{
        Name = $_.Name
        FreeGB = [math]::Round($_.Free / 1GB, 2)
        UsedGB = [math]::Round($_.Used / 1GB, 2)
    }
} | Format-Table -AutoSize
"""
b64 = base64.b64encode(ps.encode('utf-16le')).decode('ascii')
_, stdout, _ = client.exec_command(f'powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand {b64}')
print(stdout.read().decode())
client.close()
db.close()
