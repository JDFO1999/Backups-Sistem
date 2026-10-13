from fastapi.testclient import TestClient
from app.main import app
from app.core.config import settings
from app.utils.formatters import format_bytes

client = TestClient(app)

def test_format_bytes():
    assert format_bytes(0) == "0.0 B" or format_bytes(0) == "0 B"
    assert "KB" in format_bytes(2048)
    assert "MB" in format_bytes(10 * 1024 * 1024)
    assert "GB" in format_bytes(5 * 1024 * 1024 * 1024)
    assert "TB" in format_bytes(2 * 1024 * 1024 * 1024 * 1024)

def test_estimate_empty_selection():
    login_res = client.post(
        f"{settings.API_V1_STR}/auth/login",
        json={"email": settings.FIRST_SUPERUSER_EMAIL, "password": settings.FIRST_SUPERUSER_PASSWORD}
    )
    headers = {"Authorization": f"Bearer {login_res.json()['access_token']}"}

    res = client.post(f"{settings.API_V1_STR}/databases/estimate", json={"database_ids": []}, headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["selected_count"] == 0
    assert data["total_original_bytes"] == 0
