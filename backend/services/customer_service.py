"""
Customer business logic — extracted from routers/customers.py.
"""
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional

from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

import models, schemas

logger = logging.getLogger("rico_net.customers")


# ------------------------------------------------------------------
# Audit log helper — shared by customer updates and field-survey submits
# ------------------------------------------------------------------

# Fields we care about tracking. Anything not in this list is ignored by the
# diff helper — we do NOT want noise from `last_updated`, relationships, etc.
AUDITED_FIELDS = {
    "first_name",
    "last_name",
    "phone",
    "email",
    "notes",
    "railwire_address",
    "rico_address",
    "geo_lat",
    "geo_long",
    "gps_lat",
    "gps_lng",
    "gps_accuracy_m",
    "pole_id",
    "splitter_id",
    "mac_address",
    "wifi_ssid",
    "wifi_ssid_5g",
    "wifi_password",
    "plan_name",
    "status",
    "balance",
    "expiry_date",
    "olt_host",
    "pon_port",
    "onu_index",
    "pg_id",
    "install_photo_url",
    "device_setup",
    "ont_model",
    "ont_serial_number",
    "ont_sticker_data",
    "router_mac_address",
    "router_model",
    "router_serial",
    "router_sticker_data",
    "connection_status",
}


def _fmt(val: Any) -> Optional[str]:
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.isoformat()
    return str(val)


def write_customer_audit(
    db: Session,
    *,
    customer_id: str,
    changes: Iterable[Dict[str, Any]],
    changed_by: str,
    action: str = "UPDATE",
) -> int:
    """
    Insert audit rows for a batch of field changes. `changes` is an iterable of
    {field_name, old_value, new_value}. Caller must still commit the session.
    Returns the number of rows inserted.
    """
    inserted = 0
    for change in changes:
        db.add(models.CustomerAuditLog(
            customer_id=customer_id,
            action=action,
            field_name=change["field_name"],
            old_value=_fmt(change.get("old_value")),
            new_value=_fmt(change.get("new_value")),
            changed_by=changed_by or "System",
        ))
        inserted += 1
    return inserted


def diff_and_apply(
    db_cust: models.Customer,
    patch: Dict[str, Any],
) -> list[Dict[str, Any]]:
    """
    Apply a patch dict to a Customer ORM row and return a list of field-level
    changes for the audit log. Skips fields not in AUDITED_FIELDS and fields
    where the value did not actually change.
    """
    changes: list[Dict[str, Any]] = []
    for field, new_val in patch.items():
        if field not in AUDITED_FIELDS:
            continue
        if new_val is None:
            # patch is sparse — None means "don't touch"
            continue
        old_val = getattr(db_cust, field, None)
        if old_val == new_val:
            continue
        changes.append({
            "field_name": field,
            "old_value": old_val,
            "new_value": new_val,
        })
        setattr(db_cust, field, new_val)
    return changes


# ------------------------------------------------------------------
# Lookup (autocomplete)
# ------------------------------------------------------------------

def get_customer_lookup(db: Session):
    """Return lightweight customer list for autocomplete."""
    try:
        results = db.query(
            models.Customer.username,
            models.Customer.first_name,
            models.Customer.phone,
        ).all()

        return [
            {
                "username": r.username,
                "display": f"{r.username} | {r.first_name or ''} | {r.phone or ''}",
            }
            for r in results
        ]
    except SQLAlchemyError as e:
        logger.error("Database error in customer lookup: %s", str(e))
        raise HTTPException(status_code=503, detail="Database temporarily unavailable")


# ------------------------------------------------------------------
# Dashboard stats
# ------------------------------------------------------------------

def get_customer_stats(db: Session):
    """Compute dashboard-level customer statistics."""
    try:
        total_customers = db.query(models.Customer).count()
        total_outstanding = db.query(func.sum(models.Customer.balance)).scalar() or 0.0

        overdue_count = db.query(models.Customer).filter(models.Customer.balance > 0).count()

        active_customers = db.query(models.Customer).filter(
            models.Customer.status == "Active"
        ).count()
        inactive_customers = total_customers - active_customers

        today = date.today()
        expiring_today_count = db.query(models.Customer).filter(
            func.date(models.Customer.expiry_date) == today
        ).count()

        return {
            "total_outstanding": total_outstanding,
            "overdue_count": overdue_count,
            "active_customers": active_customers,
            "inactive_customers": inactive_customers,
            "total_customers": total_customers,
            "expiring_today_count": expiring_today_count,
            "in_draft": 0,
            "projects": 0,
        }
    except SQLAlchemyError as e:
        logger.error("Database error in dashboard stats: %s", str(e))
        raise HTTPException(status_code=503, detail="Database temporarily unavailable")


# ------------------------------------------------------------------
# Operations Centre — single-call intelligence for the dashboard
# ------------------------------------------------------------------

def get_operations_summary(db: Session) -> Dict:
    """
    Returns everything the operations centre needs in one DB round-trip.
    Powers GET /customers/operations-summary.
    """
    try:
        today = date.today()
        week_end = today + timedelta(days=7)
        day_ago = datetime.now(timezone.utc) - timedelta(hours=24)
        today_start = datetime.combine(today, datetime.min.time()).replace(tzinfo=timezone.utc)

        # ── Business numbers ──────────────────────────────────────────
        total_customers = db.query(models.Customer).count()
        active_customers = db.query(models.Customer).filter(
            models.Customer.status == "Active"
        ).count()
        total_outstanding = db.query(func.sum(models.Customer.balance)).scalar() or 0.0
        overdue_count = db.query(models.Customer).filter(models.Customer.balance > 0).count()

        # ── Attention lists ───────────────────────────────────────────
        expiring_today_rows = (
            db.query(models.Customer)
            .filter(
                func.date(models.Customer.expiry_date) == today,
                models.Customer.status == "Active",
            )
            .order_by(models.Customer.first_name)
            .limit(50)
            .all()
        )

        expiring_week_rows = (
            db.query(models.Customer)
            .filter(
                func.date(models.Customer.expiry_date) > today,
                func.date(models.Customer.expiry_date) <= week_end,
                models.Customer.status == "Active",
            )
            .order_by(models.Customer.expiry_date)
            .limit(50)
            .all()
        )

        unpaid_rows = (
            db.query(models.Customer)
            .filter(
                models.Customer.balance > 0,
                models.Customer.status == "Active",
            )
            .order_by(models.Customer.balance.desc())
            .limit(50)
            .all()
        )

        # ── Network health ────────────────────────────────────────────
        total_monitored = db.query(models.Customer).filter(
            models.Customer.mac_address.isnot(None)
        ).count()

        online_count = (
            db.query(models.Customer)
            .join(models.ONULatest, models.Customer.mac_address == models.ONULatest.mac_address)
            .filter(models.ONULatest.status == "online")
            .count()
        )
        dying_gasp_count = (
            db.query(models.Customer)
            .join(models.ONULatest, models.Customer.mac_address == models.ONULatest.mac_address)
            .filter(models.ONULatest.dying_gasp == True)
            .count()
        )
        offline_count = (
            db.query(models.Customer)
            .join(models.ONULatest, models.Customer.mac_address == models.ONULatest.mac_address)
            .filter(models.ONULatest.status == "offline", models.ONULatest.dying_gasp == False)
            .count()
        )
        weak_signal_count = (
            db.query(models.Customer)
            .join(models.ONULatest, models.Customer.mac_address == models.ONULatest.mac_address)
            .filter(
                models.ONULatest.rx_power_dbm.isnot(None),
                models.ONULatest.rx_power_dbm < -24,
                models.ONULatest.rx_power_dbm >= -27,
            )
            .count()
        )
        critical_signal_count = (
            db.query(models.Customer)
            .join(models.ONULatest, models.Customer.mac_address == models.ONULatest.mac_address)
            .filter(
                models.ONULatest.rx_power_dbm.isnot(None),
                models.ONULatest.rx_power_dbm < -27,
            )
            .count()
        )

        # ── ONU offline with no open ticket ───────────────────────────
        offline_pairs = (
            db.query(models.Customer, models.ONULatest)
            .join(models.ONULatest, models.Customer.mac_address == models.ONULatest.mac_address)
            .filter(
                models.ONULatest.status == "offline",
                models.ONULatest.dying_gasp == False,
                models.Customer.status == "Active",
            )
            .order_by(models.ONULatest.polled_at.asc())
            .limit(30)
            .all()
        )

        offline_no_ticket: List[Dict] = []
        for cust, onu in offline_pairs:
            has_open = db.query(models.Ticket).filter(
                models.Ticket.customer_id == cust.username,
                models.Ticket.status.in_(["Open", "Assigned", "Ongoing"]),
            ).first()
            if not has_open:
                offline_no_ticket.append({
                    "username": cust.username,
                    "name": f"{cust.first_name or ''} {cust.last_name or ''}".strip() or cust.username,
                    "phone": cust.phone,
                    "mac_address": cust.mac_address,
                    "offline_since": onu.polled_at.isoformat() if onu.polled_at else None,
                    "olt_host": onu.olt_host,
                    "rx_power_dbm": onu.rx_power_dbm,
                })
            if len(offline_no_ticket) >= 20:
                break

        # ── Ticket numbers ────────────────────────────────────────────
        open_tickets = db.query(models.Ticket).filter(models.Ticket.status == "Open").count()
        assigned_tickets = db.query(models.Ticket).filter(models.Ticket.status == "Assigned").count()
        ongoing_tickets = db.query(models.Ticket).filter(models.Ticket.status == "Ongoing").count()
        overdue_tickets = db.query(models.Ticket).filter(
            models.Ticket.status.in_(["Open", "Assigned"]),
            models.Ticket.created_at < day_ago,
        ).count()
        created_today = db.query(models.Ticket).filter(
            models.Ticket.created_at >= today_start
        ).count()
        resolved_today = db.query(models.Ticket).filter(
            models.Ticket.status.in_(["Resolved", "Closed"]),
            or_(
                models.Ticket.resolved_at >= today_start,
                models.Ticket.closed_at >= today_start,
            ),
        ).count()

        recent_open = (
            db.query(models.Ticket)
            .filter(models.Ticket.status.in_(["Open", "Assigned", "Ongoing"]))
            .order_by(models.Ticket.created_at.desc())
            .limit(8)
            .all()
        )

        def _fmt(c: models.Customer) -> Dict:
            return {
                "username": c.username,
                "name": f"{c.first_name or ''} {c.last_name or ''}".strip() or c.username,
                "phone": c.phone,
                "plan_name": c.plan_name,
                "expiry_date": c.expiry_date.isoformat() if c.expiry_date else None,
                "balance": float(c.balance or 0),
            }

        return {
            "business": {
                "total_customers": total_customers,
                "active_customers": active_customers,
                "inactive_customers": total_customers - active_customers,
                "total_outstanding": float(total_outstanding),
                "overdue_count": overdue_count,
                "expiring_today_count": len(expiring_today_rows),
                "expiring_week_count": len(expiring_week_rows),
            },
            "network": {
                "total_monitored": total_monitored,
                "unmonitored": total_customers - total_monitored,
                "online": online_count,
                "offline": offline_count,
                "dying_gasp": dying_gasp_count,
                "weak_signal": weak_signal_count,
                "critical_signal": critical_signal_count,
            },
            "tickets": {
                "open": open_tickets,
                "assigned": assigned_tickets,
                "ongoing": ongoing_tickets,
                "overdue": overdue_tickets,
                "created_today": created_today,
                "resolved_today": resolved_today,
                "active_total": open_tickets + assigned_tickets + ongoing_tickets,
                "recent_open": [
                    {
                        "id": t.id,
                        "customer_id": t.customer_id,
                        "issue_type": t.issue_type,
                        "status": t.status,
                        "priority": t.priority,
                        "created_at": t.created_at.isoformat(),
                    }
                    for t in recent_open
                ],
            },
            "attention": {
                "expiring_today": [_fmt(c) for c in expiring_today_rows],
                "expiring_week": [_fmt(c) for c in expiring_week_rows],
                "unpaid": [_fmt(c) for c in unpaid_rows],
                "offline_no_ticket": offline_no_ticket,
            },
        }
    except SQLAlchemyError as e:
        logger.error("operations summary DB error: %s", e)
        raise HTTPException(status_code=503, detail="Database temporarily unavailable")


# ------------------------------------------------------------------
# CRUD
# ------------------------------------------------------------------

def create_customer(db: Session, customer: schemas.CustomerCreate, current_username: str):
    """Create a new customer record."""
    existing = db.query(models.Customer).filter(
        models.Customer.username == customer.username
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Username already registered")

    db_cust = models.Customer(**customer.model_dump())
    db.add(db_cust)
    try:
        db.commit()
        db.refresh(db_cust)
    except IntegrityError:
        db.rollback()
        logger.warning("Duplicate customer creation attempt: %s", customer.username)
        raise HTTPException(status_code=409, detail="Username already registered")
    except SQLAlchemyError as e:
        db.rollback()
        logger.error("Database error creating customer %s: %s", customer.username, str(e))
        raise HTTPException(status_code=500, detail="Failed to create customer")

    logger.info("Customer created: %s by %s", customer.username, current_username)
    return db_cust


def get_customer_by_id(db: Session, customer_id: int):
    """Fetch a customer by numeric ID."""
    try:
        user = db.query(models.Customer).filter(
            models.Customer.id == customer_id
        ).first()
    except SQLAlchemyError as e:
        logger.error("Database error fetching customer by id %d: %s", customer_id, str(e))
        raise HTTPException(status_code=503, detail="Database temporarily unavailable")

    if not user:
        raise HTTPException(status_code=404, detail="Customer not found")

    return user


def update_connection_status(
    db: Session,
    customer_id: str,
    payload: schemas.ConnectionStatusUpdate,
    current_username: str,
):
    """Update a customer's connection status (online/offline/intermittent)."""
    db_cust = db.query(models.Customer).filter(
        models.Customer.username == customer_id
    ).first()

    if not db_cust:
        raise HTTPException(status_code=404, detail="Customer not found")

    db_cust.connection_status = payload.status
    db_cust.last_seen_online = payload.last_seen or datetime.now(timezone.utc)

    try:
        db.commit()
        db.refresh(db_cust)
    except SQLAlchemyError as e:
        db.rollback()
        logger.error("Database error updating connection status for %s: %s", customer_id, str(e))
        raise HTTPException(status_code=500, detail="Failed to update connection status")

    logger.info("Connection status updated for %s: %s by %s", customer_id, payload.status, current_username)
    return db_cust


def get_customer(db: Session, username: str):
    """Fetch a single customer by username."""
    try:
        user = db.query(models.Customer).filter(
            models.Customer.username == username
        ).first()
    except SQLAlchemyError as e:
        logger.error("Database error fetching customer %s: %s", username, str(e))
        raise HTTPException(status_code=503, detail="Database temporarily unavailable")

    if not user:
        raise HTTPException(status_code=404, detail="Customer not found")

    return user


def list_customers(
    db: Session,
    skip: int = 0,
    limit: int = 10,
    q: Optional[str] = None,
    search: Optional[str] = None,
    status: Optional[str] = None,
    expiry_filter: Optional[str] = None,
    expiry_start: Optional[date] = None,
    expiry_end: Optional[date] = None,
):
    """List customers with filtering and pagination."""
    skip = max(skip, 0)
    limit = min(max(limit, 1), 200)

    # Accept both ?q= and ?search= (mobile uses ?search=)
    search_term_raw = q or search

    try:
        query = db.query(models.Customer)

        # Text search — searches across username, first/last name, full name combo,
        # phone, and both address fields so that partial names like "ahamed" or
        # street names like "kamber" all return results.
        if search_term_raw:
            search_term = f"%{search_term_raw}%"
            query = query.filter(
                or_(
                    models.Customer.username.ilike(search_term),
                    models.Customer.first_name.ilike(search_term),
                    models.Customer.last_name.ilike(search_term),
                    models.Customer.phone.ilike(search_term),
                    models.Customer.railwire_address.ilike(search_term),
                    models.Customer.rico_address.ilike(search_term),
                    func.concat(
                        func.coalesce(models.Customer.first_name, ''),
                        ' ',
                        func.coalesce(models.Customer.last_name, ''),
                    ).ilike(search_term),
                )
            )

        # Status filter
        if status and status.lower() != "all":
            query = query.filter(models.Customer.status == status)

        # Expiry date range
        if expiry_start and expiry_end:
            query = query.filter(
                func.date(models.Customer.expiry_date) >= expiry_start,
                func.date(models.Customer.expiry_date) <= expiry_end,
            )
        elif expiry_start:
            query = query.filter(func.date(models.Customer.expiry_date) >= expiry_start)
        elif expiry_end:
            query = query.filter(func.date(models.Customer.expiry_date) <= expiry_end)

        # Legacy shortcut
        if expiry_filter == "today" and not (expiry_start or expiry_end):
            today = date.today()
            query = query.filter(func.date(models.Customer.expiry_date) == today)

        total = query.count()
        items = query.order_by(models.Customer.username).offset(skip).limit(limit).all()

        return {"items": items, "total": total}
    except SQLAlchemyError as e:
        logger.error("Database error listing customers: %s", str(e))
        raise HTTPException(status_code=503, detail="Database temporarily unavailable")


def update_customer(db: Session, username: str, data: schemas.CustomerUpdate, current_username: str):
    """Update an existing customer's fields and write per-field audit rows."""
    db_cust = db.query(models.Customer).filter(
        models.Customer.username == username
    ).first()

    if not db_cust:
        raise HTTPException(status_code=404, detail="Customer not found")

    patch = data.model_dump(exclude_unset=True)
    changes = diff_and_apply(db_cust, patch)

    if changes:
        write_customer_audit(
            db,
            customer_id=username,
            changes=changes,
            changed_by=current_username,
            action="UPDATE",
        )

    try:
        db.commit()
        db.refresh(db_cust)
    except SQLAlchemyError as e:
        db.rollback()
        logger.error("Database error updating customer %s: %s", username, str(e))
        raise HTTPException(status_code=500, detail="Failed to update customer")

    if changes:
        logger.info(
            "Customer %s updated by %s — %d fields changed",
            username, current_username, len(changes),
        )
    return db_cust


def delete_customer(db: Session, username: str, current_user: models.Technician):
    """
    Soft-delete a customer — marks status as 'Departed' and logs the change.
    No data is ever erased: all history (tickets, audit logs, ONU bindings) remains.
    Admin only.
    """
    if current_user.role != "Admin":
        raise HTTPException(status_code=403, detail="Only Admin users can deactivate customers")

    db_cust = db.query(models.Customer).filter(
        models.Customer.username == username
    ).first()
    if not db_cust:
        raise HTTPException(status_code=404, detail="Customer not found")

    if db_cust.status == "Departed":
        return {"message": "Customer is already marked as Departed", "username": username}

    changes = diff_and_apply(db_cust, {"status": "Departed"})
    if changes:
        write_customer_audit(
            db,
            customer_id=username,
            changes=changes,
            changed_by=current_user.username,
            action="SOFT_DELETE",
        )

    try:
        db.commit()
    except SQLAlchemyError as e:
        db.rollback()
        logger.error("Database error soft-deleting customer %s: %s", username, str(e))
        raise HTTPException(status_code=500, detail="Failed to deactivate customer")

    logger.info("Customer soft-deleted (Departed): %s by %s", username, current_user.username)
    return {"message": "Customer marked as Departed. All data retained.", "username": username}
