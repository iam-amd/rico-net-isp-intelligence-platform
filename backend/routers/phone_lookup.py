"""
Rico Net CMS V2 -- Phone Lookup & Customer Phones Router
=========================================================
Thin HTTP wrapper — all business logic lives in services/phone_lookup_service.py.
"""
from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session
from typing import List

import models, schemas
from database import get_db
from middleware.auth import get_current_user
from services import phone_lookup_service

router = APIRouter(tags=["Phone Lookup"])

# --- Rate limiter (conditional) ---
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


# =============================================================================
# 1. PHONE LOOKUP -- THE "CALL POP-UP"
# =============================================================================

@router.get("/phone-lookup/{number}", response_model=schemas.PhoneLookupResponse)
@_limit("30/minute")
def phone_lookup(
    number: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    return phone_lookup_service.phone_lookup(db, number)


# =============================================================================
# 2. LIST LINKED PHONES FOR A CUSTOMER
# =============================================================================

@router.get(
    "/customers/{username}/phones",
    response_model=List[schemas.CustomerPhoneResponse],
)
def list_customer_phones(
    username: str,
    db: Session = Depends(get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    return phone_lookup_service.list_customer_phones(db, username)


# =============================================================================
# 3. ADD A LINKED PHONE NUMBER
# =============================================================================

@router.post(
    "/customers/{username}/phones",
    response_model=schemas.CustomerPhoneResponse,
)
def add_customer_phone(
    username: str,
    phone_data: schemas.CustomerPhoneCreate,
    db: Session = Depends(get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    return phone_lookup_service.add_customer_phone(db, username, phone_data, current_user.username)


# =============================================================================
# 4. DELETE A LINKED PHONE NUMBER
# =============================================================================

@router.delete("/customers/{username}/phones/{phone_id}")
def delete_customer_phone(
    username: str,
    phone_id: int,
    db: Session = Depends(get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    return phone_lookup_service.delete_customer_phone(db, username, phone_id, current_user.username)
