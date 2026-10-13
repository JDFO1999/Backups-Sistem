from typing import List
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.deps import get_current_active_admin, get_client_ip
from app.core.security import get_password_hash
from app.models import User, Role
from app.schemas.user import UserCreate, UserUpdate, UserResponse
from app.services.audit_service import log_audit

router = APIRouter()

@router.get("", response_model=List[UserResponse])
def list_users(
    skip: int = 0,
    limit: int = 100,
    admin: User = Depends(get_current_active_admin),
    db: Session = Depends(get_db)
):
    return db.query(User).offset(skip).limit(limit).all()

@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_user(
    user_in: UserCreate,
    request: Request,
    admin: User = Depends(get_current_active_admin),
    db: Session = Depends(get_db)
):
    existing = db.query(User).filter(User.email == user_in.email).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ya existe un usuario registrado con este correo electrónico."
        )

    role = db.query(Role).filter(Role.name == user_in.role_name.upper()).first()
    if not role:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Rol '{user_in.role_name}' inválido. Debe ser ADMIN o USER."
        )

    user = User(
        email=user_in.email,
        hashed_password=get_password_hash(user_in.password),
        full_name=user_in.full_name,
        role_id=role.id,
        is_active=True
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    log_audit(
        db, action="CREATE_USER",
        user=admin,
        resource_type="USER",
        resource_id=user.id,
        ip_address=get_client_ip(request),
        details={"email": user.email, "role": role.name}
    )

    return user

@router.put("/{user_id}", response_model=UserResponse)
def update_user(
    user_id: int,
    user_in: UserUpdate,
    request: Request,
    admin: User = Depends(get_current_active_admin),
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado.")

    if user_in.email and user_in.email != user.email:
        exist = db.query(User).filter(User.email == user_in.email).first()
        if exist:
            raise HTTPException(status_code=400, detail="El correo ya se encuentra en uso.")
        user.email = user_in.email

    if user_in.full_name is not None:
        user.full_name = user_in.full_name

    if user_in.password:
        user.hashed_password = get_password_hash(user_in.password)

    if user_in.is_active is not None:
        if user.id == admin.id and not user_in.is_active:
            raise HTTPException(status_code=400, detail="No puedes desactivar tu propia cuenta.")
        user.is_active = user_in.is_active

    if user_in.role_name:
        role = db.query(Role).filter(Role.name == user_in.role_name.upper()).first()
        if not role:
            raise HTTPException(status_code=400, detail="Rol inválido.")
        if user.id == admin.id and role.name != "ADMIN":
            raise HTTPException(status_code=400, detail="No puedes remover tu propio rol de ADMIN.")
        user.role_id = role.id

    db.commit()
    db.refresh(user)

    log_audit(
        db, action="UPDATE_USER",
        user=admin,
        resource_type="USER",
        resource_id=user.id,
        ip_address=get_client_ip(request),
        details={"updated_fields": user_in.model_dump(exclude_unset=True, exclude={'password'})}
    )

    return user

@router.delete("/{user_id}")
def delete_user(
    user_id: int,
    request: Request,
    admin: User = Depends(get_current_active_admin),
    db: Session = Depends(get_db)
):
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="No puedes eliminar tu propia cuenta de administrador.")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")

    db.delete(user)
    db.commit()

    log_audit(
        db, action="DELETE_USER",
        user=admin,
        resource_type="USER",
        resource_id=user_id,
        ip_address=get_client_ip(request),
        details={"email": user.email}
    )

    return {"message": "Usuario eliminado exitosamente."}
