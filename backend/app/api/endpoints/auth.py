from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_user, get_client_ip
from app.core.security import (
    verify_password, get_password_hash,
    create_access_token, create_refresh_token, decode_token
)
from app.models import User
from app.schemas.auth import (
    Token, LoginRequest, RefreshTokenRequest, PasswordResetRequest
)
from app.schemas.user import UserResponse
from app.services.audit_service import log_audit

router = APIRouter()

@router.post("/login", response_model=Token)
def login(
    login_data: LoginRequest,
    request: Request,
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.email == login_data.email).first()
    client_ip = get_client_ip(request)

    if not user or not verify_password(login_data.password, user.hashed_password):
        log_audit(
            db, action="LOGIN_FAILED",
            user_email=login_data.email,
            ip_address=client_ip,
            status="FAILURE",
            details={"reason": "Credenciales inválidas"}
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Correo electrónico o contraseña incorrectos."
        )

    if not user.is_active:
        log_audit(
            db, action="LOGIN_BLOCKED",
            user=user,
            ip_address=client_ip,
            status="FAILURE",
            details={"reason": "Usuario inactivo"}
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Esta cuenta ha sido desactivada."
        )

    role_name = user.role.name if user.role else "USER"
    access_token = create_access_token(subject=user.id, role=role_name)
    refresh_token = create_refresh_token(subject=user.id)

    log_audit(
        db, action="LOGIN",
        user=user,
        ip_address=client_ip,
        status="SUCCESS"
    )

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "expires_in": settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        "user": {
            "id": user.id,
            "email": user.email,
            "full_name": user.full_name,
            "role": role_name
        }
    }

@router.post("/refresh", response_model=Token)
def refresh_token(
    refresh_data: RefreshTokenRequest,
    request: Request,
    db: Session = Depends(get_db)
):
    payload = decode_token(refresh_data.refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token de refresco inválido o expirado."
        )
    user_id = payload.get("sub")
    user = db.query(User).filter(User.id == int(user_id)).first()
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuario inválido o inactivo."
        )

    role_name = user.role.name if user.role else "USER"
    access_token = create_access_token(subject=user.id, role=role_name)
    new_refresh_token = create_refresh_token(subject=user.id)

    return {
        "access_token": access_token,
        "refresh_token": new_refresh_token,
        "token_type": "bearer",
        "expires_in": settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        "user": {
            "id": user.id,
            "email": user.email,
            "full_name": user.full_name,
            "role": role_name
        }
    }

@router.get("/me", response_model=UserResponse)
def get_current_user_profile(
    current_user: User = Depends(get_current_user)
):
    return current_user

@router.post("/change-password")
def change_password(
    password_data: PasswordResetRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if not verify_password(password_data.current_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La contraseña actual no es correcta."
        )
    if len(password_data.new_password) < 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La nueva contraseña debe tener al menos 8 caracteres."
        )

    current_user.hashed_password = get_password_hash(password_data.new_password)
    db.commit()

    log_audit(
        db, action="CHANGE_PASSWORD",
        user=current_user,
        ip_address=get_client_ip(request),
        status="SUCCESS"
    )

    return {"message": "Contraseña actualizada exitosamente."}

@router.post("/logout")
def logout(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    log_audit(
        db, action="LOGOUT",
        user=current_user,
        ip_address=get_client_ip(request),
        status="SUCCESS"
    )
    return {"message": "Sesión cerrada exitosamente."}
