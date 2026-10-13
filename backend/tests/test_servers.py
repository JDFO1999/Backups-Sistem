import uuid
from fastapi.testclient import TestClient
from unittest.mock import patch
from app.main import app
from app.core.config import settings

client = TestClient(app)

def get_auth_token():
    res = client.post(
        f"{settings.API_V1_STR}/auth/login",
        json={
            "email": settings.FIRST_SUPERUSER_EMAIL,
            "password": settings.FIRST_SUPERUSER_PASSWORD
        }
    )
    return res.json()["access_token"]

def test_server_creation_and_encryption():
    token = get_auth_token()
    headers = {"Authorization": f"Bearer {token}"}

    unique_name = f"Test-Server-{uuid.uuid4().hex[:6]}"
    server_payload = {
        "name": unique_name,
        "host": "192.168.1.100",
        "ssh_port": 2222,
        "username": "deploy",
        "auth_type": "KEY",
        "ssh_key": "-----BEGIN OPENSSH PRIVATE KEY-----\nMOCK_KEY_DATA_HERE\n-----END OPENSSH PRIVATE KEY-----",
        "os_info": "Ubuntu 24.04 LTS"
    }

    # Create server
    res = client.post(f"{settings.API_V1_STR}/servers", json=server_payload, headers=headers)
    assert res.status_code == 201
    server = res.json()
    assert server["name"] == unique_name
    assert server["has_key"] is True
    # Verify private key is NEVER returned in the API response
    assert "ssh_key" not in server
    assert "encrypted_ssh_key" not in server

    server_id = server["id"]

    # Test server test endpoint with mock
    with patch("app.services.ssh_service.SSHService.test_connection") as mock_test:
        mock_test.return_value = (True, 14.5, "Ubuntu 24.04 (Linux 6.8)", "Conexión SSH exitosa.")
        test_res = client.post(f"{settings.API_V1_STR}/servers/{server_id}/test", headers=headers)
        assert test_res.status_code == 200
        test_data = test_res.json()
        assert test_data["success"] is True
        assert test_data["latency_ms"] == 14.5
