"""
Rico Net CMS — Authentication Router
======================================
JWT-based auth with rate limiting and structured logging.

JWT utilities (verify_password, get_password_hash, create_access_token,
get_current_user, require_admin, oauth2_scheme) live in middleware/auth.py
and should be imported from there. This module owns the route handlers only.
"""
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

import database, models
from config.settings import settings
from middleware.auth import (
    create_access_token,
    get_current_user,
    verify_password,
)

logger = logging.getLogger("rico_net.auth")

router = APIRouter(tags=["Authentication"])

# --- Rate limiter (graceful degradation if slowapi missing) ---
try:
    from slowapi import Limiter
    from slowapi.util import get_remote_address

    limiter = Limiter(key_func=get_remote_address)
    _RATE_LIMITING = True
except ImportError:
    limiter = None
    _RATE_LIMITING = False


def _limit(rate: str):
    if _RATE_LIMITING and limiter:
        return limiter.limit(rate)

    def _noop(func):
        return func

    return _noop


class Token(BaseModel):
    access_token: str
    token_type: str


@router.post("/auth/login", response_model=Token)
@_limit("5/minute")
def login_for_access_token(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(database.get_db),
):
    logger.info("Login attempt for user: %s", form_data.username)

    try:
        user = db.query(models.Technician).filter(
            models.Technician.username == form_data.username
        ).first()
    except SQLAlchemyError as e:
        logger.error("Database error during login: %s", str(e))
        raise HTTPException(status_code=503, detail="Database temporarily unavailable")

    if not user or not verify_password(form_data.password, user.hashed_password):
        logger.warning("Failed login attempt for user: %s", form_data.username)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if user.is_active != 1:
        logger.warning("Login attempt for inactive user: %s", form_data.username)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive",
        )

    user.last_login = datetime.now(timezone.utc)
    try:
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        logger.error("Failed to update last_login for user: %s", form_data.username)

    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.username, "role": user.role},
        expires_delta=access_token_expires,
    )

    logger.info("Login successful for user: %s (role=%s)", user.username, user.role)
    return {"access_token": access_token, "token_type": "bearer"}


@router.get("/auth/me")
def read_users_me(current_user: models.Technician = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "username": current_user.username,
        "full_name": current_user.full_name,
        "role": current_user.role,
        "phone": current_user.phone,
        "email": current_user.email,
        "specialization": current_user.specialization,
        "area_assigned": current_user.area_assigned,
        "is_active": current_user.is_active,
    }


@router.get("/auth/technicians-simple")
def list_technicians(
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    """Active technicians + their current workload, batched in one COUNT query."""
    try:
        techs = db.query(models.Technician).filter(
            models.Technician.is_active == 1
        ).all()

        usernames = [t.username for t in techs]

        active_map = {}
        if usernames:
            rows = (
                db.query(
                    models.Ticket.assigned_tech,
                    func.count(models.Ticket.id),
                )
                .filter(
                    models.Ticket.assigned_tech.in_(usernames),
                    models.Ticket.status.in_(["Assigned", "Ongoing"]),
                )
                .group_by(models.Ticket.assigned_tech)
                .all()
            )
            for username, count in rows:
                active_map[username] = count

        return {
            "items": [
                {
                    "id": tech.id,
                    "username": tech.username,
                    "full_name": tech.full_name,
                    "role": tech.role,
                    "active_tickets": active_map.get(tech.username, 0),
                }
                for tech in techs
            ],
            "total": len(techs),
        }
    except SQLAlchemyError as e:
        logger.error("Database error listing technicians: %s", str(e))
        raise HTTPException(status_code=503, detail="Database temporarily unavailable")
