"""
OLT Engine routes — the unified surface every consumer reads from.

Endpoints:
  GET  /engine/customer/{username}/dna     — full DNA snapshot (fast, from table)
  GET  /engine/customer/{username}/live    — force a fresh SNMP GET for one ONU
  GET  /engine/status                      — monitor summary
  POST /engine/reconcile                   — admin-only: kick off a full reconcile
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

import database
from middleware.auth import require_admin, get_current_user
from services import olt_engine
from services import olt_registry

logger = logging.getLogger("rico_net.engine_router")

router = APIRouter(prefix="/engine", tags=["OLT Engine"])


# ─── Customer DNA ────────────────────────────────────────────────────────────

@router.get("/customer/{username}/dna")
def get_customer_dna(
    username: str,
    db: Session = Depends(database.get_db),
    _user=Depends(get_current_user),
):
    """Full DNA snapshot — Railwire profile + binding + live signal + diagnosis."""
    dna = olt_engine.get_dna(db, username)
    if not dna:
        raise HTTPException(status_code=404, detail="No DNA row — has reconcile_all run yet?")

    # Join Railwire profile for full picture
    profile = db.execute(text("""
        SELECT username, first_name, last_name, phone, alt_phone, email,
               plan_name, expiry_date, balance, status, framed_ip,
               railwire_address, gps_lat, gps_lng, last_seen_online,
               ont_model, router_model
        FROM customers WHERE username = :u
    """), {"u": username}).mappings().first()

    return {
        "customer": dict(profile) if profile else None,
        "dna":      dna,
    }


@router.get("/customer/{username}/live")
def get_customer_live(
    username: str,
    db: Session = Depends(database.get_db),
    _user=Depends(get_current_user),
):
    """Force a fresh SNMP GET for the customer's ONU. Returns rx/tx/status."""
    binding = db.execute(text("""
        SELECT olt_host, pon_port, onu_index, onu_identifier, mac_address, serial_number
        FROM onu_bindings
        WHERE customer_id = :u
          AND is_active = TRUE
        ORDER BY verified_at DESC NULLS LAST, last_seen DESC NULLS LAST
        LIMIT 1
    """), {"u": username}).mappings().first()
    if not binding or not binding.get("olt_host") or binding.get("onu_index") is None:
        raise HTTPException(
            status_code=404,
            detail="No verified ONT binding position for this customer. Railwire MAC is only a discovery clue.",
        )

    olt_host = binding["olt_host"]
    # Prime registry cache so the adapter resolver can peek().
    olt_registry.list_active(db)
    adapter = olt_engine.optical_adapter_for(olt_host)
    if not adapter:
        raise HTTPException(status_code=400, detail=f"Unknown OLT {olt_host}")

    live = adapter.get_position_live(binding["pon_port"], binding["onu_index"])
    if not live:
        raise HTTPException(status_code=503, detail="OLT did not respond for live GET")

    return {
        "olt_host": olt_host, "pon_port": binding["pon_port"], "onu_index": binding["onu_index"],
        "binding_identity": binding["onu_identifier"] or binding["mac_address"] or binding["serial_number"],
        "rx_power_dbm": live.rx_power_dbm,
        "tx_power_dbm": live.tx_power_dbm,
        "temperature_c": live.temperature_c,
        "voltage_mv": live.voltage_mv,
        "status": live.status,
        "dying_gasp": live.dying_gasp,
        "polled_at": live.polled_at.isoformat() if live.polled_at else None,
    }


# ─── Status / Monitor ────────────────────────────────────────────────────────

@router.get("/status")
def get_engine_status(
    db: Session = Depends(database.get_db),
    _user=Depends(get_current_user),
):
    """For the OLT Engine Monitor page."""
    return olt_engine.get_status_summary(db)


@router.get("/runs")
def get_engine_runs(
    limit: int = 20,
    db: Session = Depends(database.get_db),
    _user=Depends(get_current_user),
):
    """Recent reconcile cycles — for the monitor page run log."""
    return {"runs": olt_engine.get_recent_runs(db, limit=min(max(1, limit), 200))}


@router.get("/changes")
def get_engine_changes(
    limit: int = 50,
    change_type: Optional[str] = None,
    username: Optional[str] = None,
    db: Session = Depends(database.get_db),
    _user=Depends(get_current_user),
):
    """State change feed — who flipped from resolved/online/etc."""
    return {"changes": olt_engine.get_recent_changes(
        db, limit=min(max(1, limit), 500),
        change_type=change_type, username=username,
    )}


@router.get("/orphans")
def get_orphan_onus(
    olt_host: Optional[str] = None,
    limit: int = 500,
    db: Session = Depends(database.get_db),
    _user=Depends(get_current_user),
):
    """ONUs in any OLT PON MAC table without a matching Railwire customer."""
    return {"orphans": olt_engine.get_orphan_onus(db, olt_host=olt_host, limit=limit)}


@router.get("/unmatched")
def get_unmatched_customers(
    limit: int = 2000,
    reason: Optional[str] = None,
    olt_host: Optional[str] = None,
    include_held: bool = True,      # by default include held_offline (stale_pon_mac)
    db: Session = Depends(database.get_db),
    _user=Depends(get_current_user),
):
    """List customers without a live binding, optionally filtered by reason + OLT.

    By default returns both `no_olt_match` (no live + no history) AND
    `stale_pon_mac` (offline but position preserved) — anyone whose ONU is not
    currently online and feeding signal.
    """
    sources = ["'no_olt_match'"]
    if include_held:
        sources.append("'stale_pon_mac'")
    sql = f"""
        SELECT c.username, c.first_name, c.last_name, c.phone,
               c.status AS railwire_status,
               c.mac_address AS railwire_mac, c.last_seen_online,
               d.unmatched_reason, d.binding_source, d.confidence,
               d.olt_host, d.pon_port, d.onu_index, d.optical_mac,
               d.last_reconciled_at
        FROM customer_dna d
        JOIN customers c ON c.username = d.username
        WHERE d.binding_source IN ({", ".join(sources)})
    """
    params: dict = {"n": min(max(1, limit), 5000)}
    if reason:
        sql += " AND d.unmatched_reason = :r"
        params["r"] = reason
    if olt_host:
        if olt_host == "__none__":
            sql += " AND d.olt_host IS NULL"
        else:
            sql += " AND d.olt_host = :olt"
            params["olt"] = olt_host
    sql += " ORDER BY d.olt_host NULLS LAST, c.username LIMIT :n"
    from sqlalchemy import text as _text
    rows = db.execute(_text(sql), params).mappings().all()

    # Per-OLT counts (always returned — for sidebar / filter buttons)
    summary_rows = db.execute(_text(f"""
        SELECT COALESCE(d.olt_host, '__none__') AS olt_host,
               COUNT(*)                                                AS total,
               COUNT(*) FILTER (WHERE d.binding_source='stale_pon_mac') AS held_offline,
               COUNT(*) FILTER (WHERE d.binding_source='no_olt_match')  AS no_olt_match
        FROM customer_dna d
        WHERE d.binding_source IN ({", ".join(sources)})
        GROUP BY 1 ORDER BY 1
    """)).mappings().all()

    return {
        "customers": [dict(r) for r in rows],
        "by_olt": [dict(r) for r in summary_rows],
    }


# ─── Reconcile trigger ───────────────────────────────────────────────────────

@router.post("/customer/{username}/resolve")
def trigger_customer_resolve(
    username: str,
    db: Session = Depends(database.get_db),
    _user=Depends(get_current_user),
):
    """Re-walk SNMP on all 3 OLTs and rebind ONE customer. Used by the
    "Re-link now" button on the unmatched-customers list."""
    try:
        result = olt_engine.resolve_one(db, username)
    except Exception as e:
        logger.exception("resolve_one failed for %s", username)
        raise HTTPException(status_code=500, detail=str(e))
    if not result.get("ok"):
        raise HTTPException(status_code=404, detail=result.get("error", "customer not found"))
    return result


@router.post("/reconcile")
def trigger_reconcile(
    background_tasks: BackgroundTasks,
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    """Admin-only: queue a full reconcile (walks all 3 OLTs + upserts customer_dna)."""
    def _run():
        from database import SessionLocal
        s = SessionLocal()
        try:
            result = olt_engine.reconcile_all(s)
            logger.info("engine.reconcile background result: %s", result)
        except Exception as exc:
            logger.exception("engine.reconcile background failed")
            try:
                s.rollback()
                olt_engine.mark_latest_unfinished_run_failed(s, str(exc))
            except Exception:
                logger.exception("failed to mark background engine reconcile run as failed")
        finally:
            s.close()

    background_tasks.add_task(_run)
    return {"queued": True, "note": "Reconcile runs in background; check /engine/status for last_reconciled_at."}
