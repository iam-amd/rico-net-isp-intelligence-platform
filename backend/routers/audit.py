"""
Rico Net CMS -- Audit Log Router
==================================
Thin HTTP wrapper — all business logic lives in services/audit_service.py.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import get_db
from middleware.auth import get_current_user
from services import audit_service

router = APIRouter(
    prefix="/audit",
    tags=["Audit Logs"]
)


@router.get("/customers/{username}")
def get_customer_audit_history(
    username: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Retrieves the complete historical audit log for a specific customer,
    showing every value that was changed, when, and by whom.
    """
    return audit_service.get_customer_audit_history(db, username)


@router.get("/customers")
def get_recent_global_audits(
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Retrieves the most recent customer changes across the entire system.
    """
    return audit_service.get_recent_global_audits(db, limit=limit)
