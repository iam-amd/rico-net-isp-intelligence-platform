"""
Rico Net — Auto-Diagnosis Service
===================================
Classifies alarm events into fault types and creates tickets automatically.
Runs as a side-effect of ingest — no HTTP context, pure DB logic.

Fault taxonomy (from Project Doc §4):
  POWER_CUT        dying_gasp=True                      → Call customer, do NOT dispatch
  FIBER_CRITICAL   Rx < -27 dBm                         → Dispatch with OTDR + fiber kit
  FIBER_WEAK       Rx -24 to -27 dBm                    → Schedule maintenance 48h
  FIBER_FLAP       flap_count > 10                      → Check splice/connector
  ONU_OFFLINE      offline, no dying_gasp               → Try remote reboot first
  AUTO_RESOLVED    came back online within 30 min       → Auto-close open offline ticket
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import and_, func, or_, text
from sqlalchemy.orm import Session

import models
from services import alarm_service
from services.onu_binding_service import find_customer_for_observed_onu

logger = logging.getLogger("rico_net.diagnosis")

# Signal thresholds (dBm)
RX_CRITICAL = -27.0
RX_WEAK = -24.0

# If customer is back online within this window, auto-close the ticket
AUTO_RESOLVE_MINUTES = 30


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def process_alarm(db: Session, alarm: models.AlarmEvent) -> Optional[models.Ticket]:
    """
    Called immediately after an alarm event is persisted.
    Classifies fault, finds linked customer by MAC, creates or updates ticket.
    Returns the auto-created Ticket or None if no action taken.
    """
    fault_type, priority, issue_type, description = _classify_alarm(alarm)
    if fault_type is None:
        return None

    customer = _find_customer(
        db,
        alarm.mac_address,
        olt_host=alarm.olt_host,
        pon_port=alarm.pon_port,
        onu_index=alarm.onu_index,
    )
    if customer is None:
        logger.warning(
            "diagnosis: alarm %d (%s) — no customer linked to MAC %s, skipping ticket "
            "(populate customers.mac_address to enable auto-ticketing)",
            alarm.id, fault_type, alarm.mac_address,
        )
        return None

    # Don't create duplicate open tickets for the same customer/issue
    existing = _find_open_ticket(db, customer.username, issue_type)
    if existing:
        logger.debug(
            "diagnosis: alarm %d — open ticket #%d already exists for %s/%s",
            alarm.id, existing.id, customer.username, issue_type,
        )
        return existing

    ticket = models.Ticket(
        customer_id=customer.username,
        issue_type=issue_type,
        priority=priority,
        status="Open",
        description=description,
        tags=f"auto,{fault_type.lower()}",
        internal_notes=(
            f"Auto-created by diagnosis engine.\n"
            f"Fault: {fault_type}\n"
            f"MAC: {alarm.mac_address}\n"
            f"OLT: {alarm.olt_host or 'unknown'}  Port: {alarm.pon_port or 'unknown'}\n"
            f"Alarm received: {alarm.received_at.strftime('%Y-%m-%d %H:%M UTC')}"
        ),
    )
    db.add(ticket)
    db.flush()  # get ticket.id without committing

    # Link alarm to auto-ticket
    alarm.auto_ticket_id = ticket.id

    db.commit()
    logger.info(
        "diagnosis: created ticket #%d (%s, %s) for customer %s  [alarm %d]",
        ticket.id, fault_type, priority, customer.username, alarm.id,
    )
    return ticket


def process_offline_outage(db: Session, mac_address: str) -> Optional[models.Ticket]:
    """
    Called when an ONU transitions from online → offline in a snapshot batch.
    Looks up OLT context from onu_latest, creates an ONU_OFFLINE alarm, and
    runs diagnosis to create a ticket if the customer is linked.

    Deduplication: suppresses repeat ONU_OFFLINE alarms within 30 minutes
    for the same MAC (handles flapping ONUs without flooding the alarm table).
    """
    # Dedup: skip if an ONU_OFFLINE alarm already exists for this MAC in the last 30 min
    existing = db.execute(
        text(
            "SELECT id FROM alarm_events "
            "WHERE mac_address = :mac AND event_type = 'ONU_OFFLINE' "
            "AND received_at >= NOW() - INTERVAL '30 minutes' "
            "LIMIT 1"
        ),
        {"mac": mac_address},
    ).fetchone()
    if existing:
        logger.debug("ONU_OFFLINE suppressed (dedup id=%d): %s", existing[0], mac_address)
        return None

    onu = db.query(models.ONULatest).filter(
        models.ONULatest.mac_address == mac_address
    ).first()

    alarm = alarm_service.open_alarm(
        db,
        mac_address=mac_address,
        event_type="ONU_OFFLINE",
        olt_host=onu.olt_host if onu else None,
        pon_port=onu.pon_port if onu else None,
        onu_index=onu.onu_index if onu else None,
        payload={
            "source": "snapshot_transition",
            "status": "offline",
            "rx_power_dbm": onu.rx_power_dbm if onu else None,
        },
        received_at=datetime.now(timezone.utc),
    )
    if alarm.status == "suppressed":
        logger.info(
            "diagnosis: ONU %s offline suppressed by maintenance window (alarm #%d)",
            mac_address,
            alarm.id,
        )
        return None

    ticket = process_alarm(db, alarm)
    db.commit()
    logger.info(
        "diagnosis: ONU %s went offline (port %s) — alarm #%d created%s",
        mac_address,
        onu.pon_port if onu else "unknown",
        alarm.id,
        f", ticket #{ticket.id}" if ticket else "",
    )
    return ticket


def process_online_recovery(db: Session, mac_address: str) -> bool:
    """
    Called when an ONU transitions from offline → online in a snapshot batch.
    If an open auto-created offline ticket exists for the linked customer,
    and it was opened within the last AUTO_RESOLVE_MINUTES, auto-close it.
    Returns True if a ticket was auto-closed.
    """
    customer = _find_customer(db, mac_address)
    if customer is None:
        return False

    cutoff = datetime.now(timezone.utc) - timedelta(minutes=AUTO_RESOLVE_MINUTES)
    ticket = (
        db.query(models.Ticket)
        .filter(
            and_(
                models.Ticket.customer_id == customer.username,
                models.Ticket.issue_type == "Connectivity",
                models.Ticket.status == "Open",
                models.Ticket.tags.like("%auto%"),
                models.Ticket.created_at >= cutoff,
            )
        )
        .order_by(models.Ticket.created_at.desc())
        .first()
    )

    if ticket is None:
        return False

    ticket.status = "Resolved"
    ticket.resolved_at = datetime.now(timezone.utc)
    ticket.resolution_remarks = (
        f"AUTO-RESOLVED: ONU {mac_address} came back online within "
        f"{AUTO_RESOLVE_MINUTES} minutes."
    )
    db.commit()
    logger.info(
        "diagnosis: auto-resolved ticket #%d for customer %s (ONU %s back online)",
        ticket.id, customer.username, mac_address,
    )
    return True


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _classify_alarm(alarm: models.AlarmEvent):
    """
    Returns (fault_type, priority, issue_type, description) or (None, None, None, None).
    """
    et = (alarm.event_type or "").upper()
    payload = alarm.payload or {}

    # Power cut — highest priority
    if et == "DYING_GASP" or payload.get("dying_gasp"):
        return (
            "POWER_CUT",
            "High",
            "Power/Outage",
            f"Dying gasp received from ONU {alarm.mac_address} on port {alarm.pon_port}. "
            f"Customer device powered off unexpectedly (likely power cut). "
            f"Call customer before dispatching.",
        )

    # Fiber critical — Rx below -27 dBm
    rx = payload.get("rx_power_dbm")
    if rx is not None and rx < RX_CRITICAL:
        return (
            "FIBER_CRITICAL",
            "High",
            "Signal Issue",
            f"Critical Rx power: {rx:.1f} dBm on ONU {alarm.mac_address} (port {alarm.pon_port}). "
            f"Threshold: {RX_CRITICAL} dBm. Dispatch with OTDR + fiber splice kit.",
        )

    # Fiber weak — Rx between -24 and -27 dBm
    if rx is not None and rx < RX_WEAK:
        return (
            "FIBER_WEAK",
            "Normal",
            "Signal Issue",
            f"Weak Rx power: {rx:.1f} dBm on ONU {alarm.mac_address} (port {alarm.pon_port}). "
            f"Threshold: {RX_WEAK} dBm. Schedule maintenance within 48 hours.",
        )

    # Fiber flap — high flap count
    flap_count = payload.get("flap_count", 0)
    if et == "FIBER_FLAP" or (flap_count and flap_count > 10):
        return (
            "FIBER_FLAP",
            "Normal",
            "Connectivity",
            f"High flap count ({flap_count}) on ONU {alarm.mac_address} (port {alarm.pon_port}). "
            f"Check splice and connector for intermittent contact.",
        )

    # Generic ONU offline — no dying gasp
    if et in ("ONU_OFFLINE", "OFFLINE") or payload.get("status") == "offline":
        return (
            "ONU_OFFLINE",
            "Normal",
            "Connectivity",
            f"ONU {alarm.mac_address} went offline on port {alarm.pon_port}. "
            f"No dying gasp — try remote reboot first before dispatching.",
        )

    # Unknown alarm type — no ticket
    return (None, None, None, None)


def _find_customer(
    db: Session,
    mac_address: str,
    *,
    olt_host: Optional[str] = None,
    pon_port: Optional[str] = None,
    onu_index: Optional[int] = None,
) -> Optional[models.Customer]:
    """Look up a customer through trusted ONU binding, then legacy EPON MAC fallback."""
    customer = find_customer_for_observed_onu(
        db,
        mac_address,
        olt_host=olt_host,
        pon_port=pon_port,
        onu_index=onu_index,
        allow_placement_match=True,
    )
    if customer:
        return customer
    return (
        db.query(models.Customer)
        .filter(func.upper(models.Customer.mac_address) == mac_address.upper())
        .first()
    )


def _find_open_ticket(
    db: Session, customer_username: str, issue_type: str
) -> Optional[models.Ticket]:
    """Return an existing open auto-ticket for the same customer and issue type."""
    return (
        db.query(models.Ticket)
        .filter(
            and_(
                models.Ticket.customer_id == customer_username,
                models.Ticket.issue_type == issue_type,
                models.Ticket.status.in_(["Open", "In Progress"]),
                models.Ticket.tags.like("%auto%"),
            )
        )
        .order_by(models.Ticket.created_at.desc())
        .first()
    )
