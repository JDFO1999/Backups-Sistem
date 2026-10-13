import base64
import hashlib
from datetime import datetime, timedelta, timezone
from typing import Any, Optional, Union
import bcrypt
import jwt
from cryptography.fernet import Fernet
from app.core.config import settings

def _get_fernet_key() -> bytes:
    """Derives a valid 32-byte url-safe base64 key from MASTER_ENCRYPTION_KEY"""
    raw_key = settings.MASTER_ENCRYPTION_KEY.encode('utf-8')
    derived = hashlib.sha256(raw_key).digest()
    return base64.urlsafe_b64encode(derived)

def encrypt_secret(plain_text: Optional[str]) -> Optional[str]:
    """Encrypt sensitive data (SSH keys, DB passwords, OAuth tokens) in rest"""
    if not plain_text:
        return None
    f = Fernet(_get_fernet_key())
    encrypted = f.encrypt(plain_text.encode('utf-8'))
    return encrypted.decode('utf-8')

def decrypt_secret(encrypted_text: Optional[str]) -> Optional[str]:
    """Decrypt sensitive data. Returns None if invalid without leaking errors"""
    if not encrypted_text:
        return None
    try:
        f = Fernet(_get_fernet_key())
        decrypted = f.decrypt(encrypted_text.encode('utf-8'))
        return decrypted.decode('utf-8')
    except Exception:
        return None

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(
            plain_password.encode('utf-8'),
            hashed_password.encode('utf-8')
        )
    except Exception:
        return False

def get_password_hash(password: str) -> str:
    salt = bcrypt.gensalt(rounds=12)
    hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
    return hashed.decode('utf-8')

def create_access_token(
    subject: Union[str, Any],
    role: str = "USER",
    expires_delta: Optional[timedelta] = None
) -> str:
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    
    to_encode = {
        "exp": expire,
        "sub": str(subject),
        "role": role,
        "type": "access"
    }
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt

def create_refresh_token(
    subject: Union[str, Any],
    expires_delta: Optional[timedelta] = None
) -> str:
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    
    to_encode = {
        "exp": expire,
        "sub": str(subject),
        "type": "refresh"
    }
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt

def decode_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM]
        )
        return payload
    except jwt.PyJWTError:
        return None
