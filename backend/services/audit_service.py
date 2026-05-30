"""
Audit Log business logic — extracted from routers/audit.py.
"""
import logging

from sqlalchemy.orm import Session

from models import CustomerAuditLog

logger = logging.getLogger("rico_net.audit")


def get_customer_audit_history(db: Session, username: str):
    """
    Retrieve the complete historical audit log for a specific customer,
    showing every value that was changed, when, and by whom.
    """
    logs = db.query(CustomerAuditLog)\
        .filter(CustomerAuditLog.customer_id == username)\
        .order_by(CustomerAuditLog.changed_at.desc())\
        .all()

    if not logs:
        # Return empty list rather than 404 so UI can show "No History"
        return []

    return logs


def get_recent_global_audits(db: Session, limit: int = 100):
    """
    Retrieve the most recent customer changes across the entire system.
    """
    limit = min(max(limit, 1), 500)
    logs = db.query(CustomerAuditLog)\
        .order_by(CustomerAuditLog.changed_at.desc())\
        .limit(limit)\
        .all()

    return logs
