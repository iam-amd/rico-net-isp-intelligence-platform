"""
Diagnostics business logic — extracted from routers/diagnostics.py.
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

import models, schemas
from services import olt_service

logger = logging.getLogger("rico_net.diagnostics")


async def run_diagnostics(db: Session, customer_username: str):
    """
    AUTO-DIAGNOSTICS CHECK.

    Run this BEFORE creating a ticket to check for:
    1. Unpaid bills (balance > 0)
    2. Active outages at the customer's network node
    3. Existing open/ongoing tickets (prevent duplicates)
    4. Recently resolved tickets (possible reoccurrence)
    5. Account status (Inactive/Suspended)
    6. Expired plan
    """
    try:
        customer = (
            db.query(models.Customer)
            .filter(models.Customer.username == customer_username)
            .first()
        )
    except SQLAlchemyError as e:
        logger.error("Database error in diagnostics lookup for %s: %s", customer_username, str(e))
        raise HTTPException(status_code=503, detail="Database temporarily unavailable")

    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    alerts = []
    can_create = True

    customer_name = f"{customer.first_name or ''} {customer.last_name or ''}".strip()

    try:
        # CHECK 1: Unpaid Bills
        balance = float(customer.balance) if customer.balance else 0.0
        if balance > 0:
            alerts.append(
                schemas.DiagnosticAlert(
                    alert_type="unpaid_bill",
                    severity="warning",
                    message=f"Customer has an outstanding balance of Rs.{balance:.2f}",
                    details={"balance": balance, "status": customer.status},
                )
            )

        # CHECK 2: Account Status
        if customer.status in ("Inactive", "Suspended"):
            alerts.append(
                schemas.DiagnosticAlert(
                    alert_type="account_status",
                    severity="critical",
                    message=f"Customer account is '{customer.status}'. Resolve account status before dispatching tech.",
                    details={"status": customer.status},
                )
            )
            can_create = False

        # CHECK 3: Active Outages at Customer's Node
        if customer.pole_id:
            node = (
                db.query(models.NetworkNode)
                .filter(models.NetworkNode.node_name == customer.pole_id)
                .first()
            )
            if node:
                active_outage = (
                    db.query(models.NodeOutage)
                    .filter(
                        models.NodeOutage.node_id == node.id,
                        models.NodeOutage.is_active == True,
                    )
                    .first()
                )
                if active_outage:
                    alerts.append(
                        schemas.DiagnosticAlert(
                            alert_type="active_outage",
                            severity="critical",
                            message=(
                                f"Known outage at {node.node_name} ({node.area or 'Unknown Area'}): "
                                f"{active_outage.outage_type}. No tech dispatch needed -- "
                                f"issue will resolve when outage is fixed."
                            ),
                            details={
                                "node_name": node.node_name,
                                "outage_type": active_outage.outage_type,
                                "started_at": str(active_outage.started_at),
                            },
                        )
                    )

        # CHECK 4: Existing Open/Assigned/Ongoing Tickets
        open_tickets = (
            db.query(models.Ticket)
            .filter(
                models.Ticket.customer_id == customer_username,
                models.Ticket.status.in_(["Open", "Assigned", "Ongoing"]),
            )
            .all()
        )
        if open_tickets:
            ticket_summaries = [
                f"#{t.id} ({t.issue_type}, {t.status})" for t in open_tickets
            ]
            alerts.append(
                schemas.DiagnosticAlert(
                    alert_type="duplicate_ticket",
                    severity="warning",
                    message=(
                        f"Customer already has {len(open_tickets)} active ticket(s): "
                        f"{', '.join(ticket_summaries)}. "
                        f"Consider updating the existing ticket instead."
                    ),
                    details={
                        "existing_ticket_ids": [t.id for t in open_tickets],
                    },
                )
            )

        # CHECK 5: Recently Resolved Tickets (last 48 hours)
        cutoff = datetime.now(timezone.utc) - timedelta(hours=48)
        recent_resolved = (
            db.query(models.Ticket)
            .filter(
                models.Ticket.customer_id == customer_username,
                models.Ticket.status.in_(["Resolved", "Closed"]),
                models.Ticket.resolved_at >= cutoff,
            )
            .all()
        )
        if recent_resolved:
            for t in recent_resolved:
                alerts.append(
                    schemas.DiagnosticAlert(
                        alert_type="recent_resolution",
                        severity="info",
                        message=(
                            f"Ticket #{t.id} ({t.issue_type}) was resolved "
                            f"recently. This may be a reoccurrence."
                        ),
                        details={"ticket_id": t.id, "resolved_at": str(t.resolved_at)},
                    )
                )

        # CHECK 6: Expired Plan
        if customer.expiry_date:
            now = datetime.now(timezone.utc)
            expiry_aware = (
                customer.expiry_date
                if customer.expiry_date.tzinfo
                else customer.expiry_date.replace(tzinfo=timezone.utc)
            )
            if expiry_aware < now:
                alerts.append(
                    schemas.DiagnosticAlert(
                        alert_type="expired_plan",
                        severity="warning",
                        message=(
                            f"Customer's plan '{customer.plan_name}' expired on "
                            f"{expiry_aware.strftime('%Y-%m-%d')}. "
                            f"Service issue may be due to expired subscription."
                        ),
                        details={
                            "plan_name": customer.plan_name,
                            "expiry_date": str(customer.expiry_date),
                        },
                    )
                )

        # CHECK 7: Fetch Live OLT Data (Phase 2)
        olt_data = None
        if customer.mac_address:
            try:
                olt_data = await olt_service.fetch_onu_by_mac(customer.mac_address)
                if olt_data:
                    # Classify faults based on OLT metrics
                    if olt_data.get("dying_gasp"):
                        alerts.append(
                            schemas.DiagnosticAlert(
                                alert_type="power_cut",
                                severity="critical",
                                message="POWER CUT detected at customer premises. Customer likely has no power. Call customer — do NOT dispatch tech.",
                                details={
                                    "mac_address": customer.mac_address,
                                    "olt_status": olt_data.get("status"),
                                    "dying_gasp": True,
                                },
                            )
                        )
                    elif olt_data.get("status") == "offline":
                        alerts.append(
                            schemas.DiagnosticAlert(
                                alert_type="onu_offline",
                                severity="critical",
                                message="ONU offline on OLT. Likely fiber cut or connector issue. Dispatch with OTDR + fiber kit.",
                                details={
                                    "mac_address": customer.mac_address,
                                    "pon_port": olt_data.get("pon_port"),
                                    "onu_index": olt_data.get("onu_index"),
                                },
                            )
                        )
                    elif olt_data.get("rx_power_dbm") and olt_data["rx_power_dbm"] < -25:
                        alerts.append(
                            schemas.DiagnosticAlert(
                                alert_type="fiber_degraded",
                                severity="warning",
                                message="Fiber signal degraded (Rx power < -25 dBm). Schedule maintenance check.",
                                details={
                                    "mac_address": customer.mac_address,
                                    "rx_power_dbm": olt_data.get("rx_power_dbm"),
                                },
                            )
                        )
                    elif olt_data.get("temperature_c") and olt_data["temperature_c"] > 65:
                        alerts.append(
                            schemas.DiagnosticAlert(
                                alert_type="onu_overheat",
                                severity="warning",
                                message="ONU temperature elevated (>65°C). Advise customer to improve ventilation.",
                                details={
                                    "mac_address": customer.mac_address,
                                    "temperature_c": olt_data.get("temperature_c"),
                                },
                            )
                        )
            except Exception as e:
                logger.error(f"Error fetching OLT data for {customer.mac_address}: {e}")
                # Graceful degradation — OLT error doesn't block diagnostics

        # Update customer connection status based on diagnostic results
        has_outage = any(a.alert_type == "active_outage" for a in alerts)
        account_blocked = any(a.alert_type == "account_status" and a.severity == "critical" for a in alerts)
        onu_offline = any(a.alert_type in ("onu_offline", "power_cut") for a in alerts)

        if has_outage or onu_offline:
            customer.connection_status = "offline"
        elif account_blocked:
            customer.connection_status = "offline"
        else:
            customer.connection_status = "online"
        customer.last_seen_online = datetime.now(timezone.utc)

        try:
            db.commit()
        except SQLAlchemyError:
            db.rollback()
            logger.warning("Failed to update connection status for %s during diagnostics", customer_username)

        # Build Summary
        if not alerts:
            summary = "All clear. No issues detected. Safe to create ticket."
        elif any(a.severity == "critical" for a in alerts):
            summary = "Critical issues detected. Review before creating ticket."
        elif any(a.severity == "warning" for a in alerts):
            summary = "Warnings detected. Review recommended before dispatch."
        else:
            summary = "Informational alerts. Safe to proceed."

        return schemas.DiagnosticsResponse(
            customer_username=customer_username,
            customer_name=customer_name,
            alerts=alerts,
            can_create_ticket=can_create,
            summary=summary,
            olt_data=olt_data,
        )
    except SQLAlchemyError as e:
        logger.error("Database error in diagnostics for %s: %s", customer_username, str(e))
        raise HTTPException(status_code=503, detail="Database temporarily unavailable")
