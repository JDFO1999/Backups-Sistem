import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.core.config import settings

client = TestClient(app)

def test_health_check():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"

def test_login_successful():
    response = client.post(
        f"{settings.API_V1_STR}/auth/login",
        json={
            "email": settings.FIRST_SUPERUSER_EMAIL,
            "password": settings.FIRST_SUPERUSER_PASSWORD
        }
    )
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert "refresh_token" in data
    assert data["user"]["role"] == "ADMIN"

def test_login_invalid_password():
    response = client.post(
        f"{settings.API_V1_STR}/auth/login",
        json={
            "email": settings.FIRST_SUPERUSER_EMAIL,
            "password": "WrongPassword999!"
        }
    )
    assert response.status_code == 401
    assert "detail" in response.json()

def test_protected_endpoint_without_token():
    response = client.get(f"{settings.API_V1_STR}/users")
    assert response.status_code == 401
