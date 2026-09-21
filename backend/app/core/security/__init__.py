
from datetime import datetime, timedelta, timezone
from pwdlib import PasswordHash
import jwt
from app.core.config import settings
from fastapi import HTTPException, status
from typing import Tuple


pwd_context = PasswordHash.recommended()

PASSWORD_POLICY_MESSAGE = (
    "Password must be at least 8 characters and include uppercase, lowercase, "
    "and digit."
)


def validate_password_policy(password: str) -> str:
    """Validate every user-selected password at the backend boundary."""
    if (
        len(password) < 8
        or not any(character.isupper() for character in password)
        or not any(character.islower() for character in password)
        or not any(character.isdigit() for character in password)
    ):
        raise ValueError(PASSWORD_POLICY_MESSAGE)
    return password


def hash_password(password: str) -> str:
    try:
        return pwd_context.hash(password)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return pwd_context.verify(plain, hashed)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


def create_access_token(data: dict, expires_delta: timedelta = None) -> Tuple[str, datetime]:
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + \
            timedelta(minutes=settings.JWT_EXPIRES_MINUTES)

    token = jwt.encode({"data": data, "exp": expire},
                       settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    return token, expire


def create_refresh_token(data: dict, expires_delta: timedelta = None) -> Tuple[str, datetime]:
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + \
            timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)

    token = jwt.encode({"data": data, "exp": expire, "type": "refresh"},
                       settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    return token, expire


def decode_token(token: str, verify_type: str = None) -> dict:
    try:
        decoded = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        if verify_type and decoded.get("type") != verify_type:
             raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")
        return decoded
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail=str(e))
