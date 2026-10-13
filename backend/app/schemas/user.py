from typing import Optional
from datetime import datetime
from pydantic import BaseModel, EmailStr, Field

class UserBase(BaseModel):
    email: EmailStr
    full_name: Optional[str] = None
    is_active: Optional[bool] = True
    role_name: Optional[str] = "USER"

class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8)
    full_name: Optional[str] = None
    role_name: str = "USER" # ADMIN or USER

class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    password: Optional[str] = Field(None, min_length=8)
    full_name: Optional[str] = None
    is_active: Optional[bool] = None
    role_name: Optional[str] = None

class RoleResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None

    class Config:
        from_attributes = True

class UserResponse(BaseModel):
    id: int
    email: str
    full_name: Optional[str] = None
    is_active: bool
    role: Optional[RoleResponse] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
