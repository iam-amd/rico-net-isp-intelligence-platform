"""
Authentication middleware — extracted from routers/auth.py.
Provides JWT utilities and FastAPI dependencies used across all routers.
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

import database
import models
from config.settings import settings

logger = logging.getLogger("rico_net.auth")

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


# --- Password Hashing ---

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(
        plain_password.encode("utf-8"),
        hashed_password.encode("utf-8"),
    )


def get_password_hash(password: str) -> str:
    return bcrypt.hashpw(
        password.encode("utf-8"),
        bcrypt.gensalt(),
    ).decode("utf-8")


# --- JWT Token ---

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


# --- Dependencies ---

def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(database.get_db),
):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    try:
        user = db.query(models.Technician).filter(models.Technician.username == username).first()
    except SQLAlchemyError as e:
        logger.error("Database error during auth lookup: %s", str(e))
        raise HTTPException(status_code=503, detail="Database temporarily unavailable")

    if user is None:
        raise credentials_exception
    if user.is_active != 1:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive",
        )
    return user


def require_admin(
    current_user: models.Technician = Depends(get_current_user),
):
    """Dependency that ensures the current user has Admin role."""
    if current_user.role != "Admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required.",
        )
    return current_user
