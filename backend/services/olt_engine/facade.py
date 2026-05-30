"""
OLT Engine faÃ§ade â€” universal 2-step procedure + observability.

reconcile_all() flow:
  STEP 1: walk PON MAC Table on each OLT â†’ unified {MAC: Position}
  STEP 2: walk optical tables â†’ {Position: signal}
  STEP 3: for each Active customer:
            * resolve via PON MAC table or sticker
            * compute unmatched_reason if unresolved
            * compare to previous DNA row â†’ emit engine_state_changes
            * UPSERT customer_dna
  STEP 4: write summary to engine_reconcile_runs
"""
from __future__ import annotations

import logging
import re
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import text
from sqlalchemy.orm import Session

from . import snmp_runner
from . import slot_occupancy
from .epon_100 import EponOLT100
from .gpon_200 import GponOLT200
from .gpon_210 import GponOLT210
from .pon_mac_adapter import get_all_olt_hosts, get_pon_mac_adapter
from .types import OpticalData, Position
from .. import olt_registry
from .. import customer_profile_enricher
from ..activity_log import emit as activity_emit, SEVERITY_INFO, SEVERITY_WARNING

logger = logging.getLogger("rico_net.olt_engine.facade")


# Adapter profile â†’ optical adapter class. Adding a 4th OLT that matches one of
# these profiles needs zero code changes (just an olt_registry row).
_OPTICAL_PROFILE_MAP = {
    "epon_netlink_v203": EponOLT100,
    "gpon_netlink_v23":  GponOLT200,
    "gpon_netlink_v14":  GponOLT210,
}


_LEGACY_OPTICAL_FALLBACK = {
    "10.10.10.100": EponOLT100,
    "10.10.10.200": GponOLT200,
    "10.10.10.210": GponOLT210,
}


def optical_adapter_for(olt_host: str):
    """Resolve the optical adapter for a given OLT host.

    Looks up `optical_adapter_profile` in the olt_registry cache; falls back
    to the 3 hardcoded mappings for OLTs that pre-date the registry.
    Returns an instantiated adapter, or None if unknown.
    """
    cfg = olt_registry.peek(olt_host)
    if cfg:
        cls = _OPTICAL_PROFILE_MAP.get(cfg.optical_adapter_profile)
        if cls:
            return cls()
    cls = _LEGACY_OPTICAL_FALLBACK.get(olt_host)
    return cls() if cls else None


# Internal alias retained for the reconcile loops in this module.
_optical_adapter_for = optical_adapter_for

_VALID_MAC = re.compile(r"^[0-9A-F]{2}(:[0-9A-F]{2}){5}$")


# â”€â”€â”€ derivations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def _signal_label(rx):
    if rx is None: return None
    if rx >= -20: return "excellent"
    if rx >= -24: return "good"
    if rx >= -27: return "weak"
    return "critical"


def _fault_type(d: OpticalData):
    if d.dying_gasp: return "POWER_CUT"
    if d.status and d.status != "online": return "ONU_OFFLINE"
    if d.rx_power_dbm is not None:
        if d.rx_power_dbm < -27: return "FIBER_CRITICAL"
        if d.rx_power_dbm < -24: return "FIBER_WEAK"
    return None


def _health_score(d: OpticalData):
    if d.status not in (None, "online"): return 0
    rx = d.rx_power_dbm
    if rx is None: return 60
    if rx >= -20: return 95
    if rx >= -24: return 80
    if rx >= -27: return 60
    return 30


def _norm_mac(mac):
    if not mac: return None
    s = mac.upper().replace("-", ":").replace(".", ":").replace(" ", "")
    if ":" not in s and len(s) == 12:
        s = ":".join(s[i:i+2] for i in range(0, 12, 2))
    return s if _VALID_MAC.match(s) else None


# â”€â”€â”€ reconcile core â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def _safe_walk(label, fn, errs):
    try:
        return fn()
    except Exception as e:
        logger.warning("%s failed: %s", label, e)
        errs[label] = str(e)[:200]
        return {}


def _categorize_unmatched(railwire_raw, railwire_norm, position, optical_present) -> str:
    if not railwire_raw or not railwire_raw.strip():
        return "no_railwire_mac"
    if not railwire_norm:
        return "mac_format_invalid"
    if position and not optical_present:
        return "position_no_optical"
    return "not_in_olt_table"


def mark_latest_unfinished_run_failed(db: Session, error: str) -> None:
    """Mark the newest unfinished engine run as failed.

    `reconcile_all()` creates its run row before the slow SNMP work starts. If
    an exception escapes later, callers may not know the run id, so this helper
    records the real cause on the newest unfinished row instead of leaving the
    monitor with a misleading ok=true/in-progress run.
    """
    db.execute(text("""
        UPDATE engine_reconcile_runs
        SET finished_at = NOW(),
            duration_seconds = EXTRACT(EPOCH FROM (NOW() - started_at)),
            ok = FALSE,
            error = :error
        WHERE id = (
            SELECT id
            FROM engine_reconcile_runs
            WHERE finished_at IS NULL
            ORDER BY started_at DESC
            LIMIT 1
        )
    """), {"error": (error or "")[:2000]})
    db.commit()


def reconcile_all(db: Session) -> Dict[str, Any]:
    started_at = datetime.now(timezone.utc)
    t0 = time.time()

    # Prime the olt_registry cache so snmp_runner + pon_mac_adapter can peek().
    olt_hosts = [c.host for c in olt_registry.list_active(db)]
    if not olt_hosts:
        # Registry empty (e.g. migration not yet applied) â€” fall back to legacy 3.
        olt_hosts = get_all_olt_hosts()
        logger.warning("olt_registry is empty; falling back to legacy hosts: %s", olt_hosts)

    # 0) Create run row up-front so children can FK it
    run_row = db.execute(text("""
        INSERT INTO engine_reconcile_runs (started_at, ok)
        VALUES (:s, TRUE)
        RETURNING id
    """), {"s": started_at}).fetchone()
    run_id = run_row[0]
    db.commit()

    olt_errors: Dict[str, str] = {}

    # STEP 1+2 â€” walk all OLTs
    unified: Dict[str, Position] = {}
    optical_all: Dict[Position, OpticalData] = {}
    pon_mac_stats: Dict[str, int] = {}
    optical_stats: Dict[str, int] = {}

    for olt in olt_hosts:
        # Cheap precheck â€” if the OLT isn't responsive right now (e.g. poller is
        # mid-walk on .210), skip the heavy walks; degradation protection will
        # preserve customer bindings on the next pass.
        if not snmp_runner.is_responsive(olt, snmp_timeout=5):
            logger.warning("%s precheck failed â€” skipping walks (OLT silent/saturated)", olt)
            pon_mac_stats[olt] = 0
            optical_stats[olt] = 0
            olt_errors[f"{olt} precheck"] = "sysDescr timeout â€” OLT silent or saturated by other SNMP walker"
            continue

        pma = get_pon_mac_adapter(olt)
        m = _safe_walk(f"{olt} pon_mac", pma.walk_pon_mac_table, olt_errors) if pma else {}
        unified.update(m)
        pon_mac_stats[olt] = len(m)

        oa = _optical_adapter_for(olt)
        o = _safe_walk(f"{olt} optical", oa.walk_optical_table, olt_errors) if oa else {}
        optical_all.update(o)
        optical_stats[olt] = len(o)

        logger.info("%s: pon_mac=%d optical=%d", olt, len(m), len(o))

    # Which OLTs successfully walked this cycle? (>0 entries means alive)
    olts_with_data = {olt for olt, n in pon_mac_stats.items() if n > 0}
    olts_failed    = {olt for olt in olt_hosts if olt not in olts_with_data}
    if olts_failed:
        logger.warning("Reconcile: OLTs with no PON MAC data this cycle: %s â€” customers bound there will be preserved", olts_failed)

    # STEP 3 â€” read CURRENT customer_dna into a dict so we can diff
    prev_rows = db.execute(text("""
        SELECT username, olt_host, pon_port, onu_index, optical_mac,
               binding_source, confidence, status, dying_gasp, unmatched_reason,
               link_status, linked_at, last_verified_at, unlink_reason
        FROM customer_dna
    """)).mappings().all()
    prev: Dict[str, Dict[str, Any]] = {r["username"]: dict(r) for r in prev_rows}

    # Also pull onu_bindings as a deeper history fallback (positions from earlier reconcilers)
    fallback_rows = db.execute(text("""
        SELECT customer_id, olt_host, pon_port, onu_index, onu_identifier, mac_address
        FROM onu_bindings
        WHERE is_active = TRUE AND olt_host IS NOT NULL AND pon_port IS NOT NULL AND onu_index IS NOT NULL
    """)).mappings().all()
    fallback: Dict[str, Dict[str, Any]] = {r["customer_id"]: dict(r) for r in fallback_rows}

    customers = db.execute(text("""
        SELECT username, first_name, last_name, phone,
               mac_address AS railwire_mac_raw,
               router_mac_address AS router_mac,
               ont_serial_number AS sticker_serial,
               ont_sticker_data
        FROM customers
        WHERE status = 'Active' AND mac_address IS NOT NULL
    """)).mappings().all()

    resolved_by_source: Dict[str, int] = {}
    unmatched_reasons: Dict[str, int] = {}
    changes: List[Tuple[str, str, str, str]] = []  # (username, type, from, to)
    now = datetime.now(timezone.utc)

    # Track which unified MACs got matched to a customer (so we can identify orphans)
    matched_macs: set[str] = set()

    for row in customers:
        username = row["username"]
        railwire_raw = row["railwire_mac_raw"]
        railwire = _norm_mac(railwire_raw)

        sticker = None
        sd = row.get("ont_sticker_data") or {}
        if isinstance(sd, dict):
            sticker = _norm_mac(sd.get("macAddress"))

        position: Optional[Position] = None
        binding_source = "no_olt_match"
        confidence = "guess"
        offset = None
        optical_mac = None

        if sticker and sticker in unified:
            position = unified[sticker]
            optical_mac = sticker
            binding_source = "sticker_scan"
            confidence = "verified"
            matched_macs.add(sticker)
            if railwire:
                offset = int(sticker.split(":")[-1], 16) - int(railwire.split(":")[-1], 16)
                matched_macs.add(railwire)   # Railwire MAC may also be in OLT (router LAN MAC)
        elif railwire and railwire in unified:
            position = unified[railwire]
            optical_mac = railwire
            binding_source = "pon_mac_table"
            confidence = "verified"
            offset = 0
            matched_macs.add(railwire)

        # â”€â”€ DEGRADATION-PROTECTION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        # Don't destroy a customer's binding because they went offline OR because
        # an OLT briefly stopped responding to SNMP. Use prev customer_dna or
        # fall back to the older onu_bindings table.
        p_existing = prev.get(username) or {}
        fb         = fallback.get(username) or {}

        prev_olt = p_existing.get("olt_host") or fb.get("olt_host")
        prev_port = p_existing.get("pon_port") or fb.get("pon_port")
        prev_idx  = p_existing.get("onu_index") if p_existing.get("onu_index") is not None else fb.get("onu_index")
        prev_optical_mac = p_existing.get("optical_mac") or fb.get("mac_address")
        prev_source      = p_existing.get("binding_source") or ""

        if binding_source == "no_olt_match" and prev_olt and prev_port and prev_idx is not None:
            # Two preservation reasons:
            #  (a) prev was verified â€” never throw away a confirmed binding
            #  (b) the OLT that prev bound them to didn't walk successfully this cycle
            olt_failed_this_cycle = prev_olt in olts_failed
            had_verified_prev     = prev_source in ("pon_mac_table", "sticker_scan", "stale_pon_mac")
            had_fallback          = bool(fb.get("olt_host"))

            if olt_failed_this_cycle or had_verified_prev or had_fallback:
                position = Position(prev_olt, prev_port, int(prev_idx))
                optical_mac = prev_optical_mac
                binding_source = "stale_pon_mac"
                confidence = "verified" if prev_source == "sticker_scan" else "probable"

        live = optical_all.get(position) if position else None
        if live is None: live = OpticalData()

        unmatched_reason = None
        if binding_source == "no_olt_match":
            unmatched_reason = _categorize_unmatched(
                railwire_raw, railwire, position, optical_present=(live.rx_power_dbm is not None)
            )
            unmatched_reasons[unmatched_reason] = unmatched_reasons.get(unmatched_reason, 0) + 1
        elif binding_source == "stale_pon_mac":
            unmatched_reason = "held_offline"
            unmatched_reasons[unmatched_reason] = unmatched_reasons.get(unmatched_reason, 0) + 1

        # â”€â”€ NEW: derive link_status (binary) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        # 'linked' iff we have a position (fresh OR preserved)
        # 'unlinked' otherwise
        link_status = "linked" if position else "unlinked"
        prev_link_status = (p_existing.get("link_status") if p_existing else None) or "unlinked"
        prev_linked_at   = p_existing.get("linked_at") if p_existing else None
        prev_position    = (p_existing.get("olt_host"), p_existing.get("pon_port"), p_existing.get("onu_index")) if p_existing else (None, None, None)
        new_position     = (position.olt_host, position.pon_port, position.onu_index) if position else (None, None, None)

        # linked_at: set on first link, immutable as long as link survives
        if link_status == "linked":
            linked_at = prev_linked_at or now
        else:
            linked_at = None

        # last_verified_at: only update when we actually FOUND the customer in PON MAC THIS cycle
        was_freshly_verified = (binding_source in ("pon_mac_table", "sticker_scan"))
        last_verified_at = now if was_freshly_verified else (p_existing.get("last_verified_at") if p_existing else None)

        # unlink_reason: only set when unlinked
        unlink_reason = unmatched_reason if link_status == "unlinked" else None

        # Emit link-state changes (in addition to the per-attribute changes above)
        if prev_link_status != link_status:
            changes.append((username, f"link_{link_status}", prev_link_status, link_status))
        elif link_status == "linked" and prev_position != new_position and any(prev_position):
            changes.append((username, "position_changed",
                            f"{prev_position[0]}/{prev_position[1]}/{prev_position[2]}",
                            f"{new_position[0]}/{new_position[1]}/{new_position[2]}"))

        resolved_by_source[binding_source] = resolved_by_source.get(binding_source, 0) + 1

        # Diff against previous to emit state changes
        p = prev.get(username)
        if p:
            was_resolved = (p["binding_source"] or "no_olt_match") != "no_olt_match"
            is_resolved  = binding_source != "no_olt_match"
            if was_resolved and not is_resolved:
                changes.append((username, "unresolved", p["binding_source"] or "", binding_source))
            if not was_resolved and is_resolved:
                changes.append((username, "resolved", p["binding_source"] or "no_olt_match", binding_source))
            prev_pos = (p["olt_host"], p["pon_port"], p["onu_index"])
            new_pos  = (position.olt_host if position else None,
                        position.pon_port if position else None,
                        position.onu_index if position else None)
            if was_resolved and is_resolved and prev_pos != new_pos:
                changes.append((username, "position_changed",
                                f"{prev_pos[0]}/{prev_pos[1]}/{prev_pos[2]}",
                                f"{new_pos[0]}/{new_pos[1]}/{new_pos[2]}"))
            prev_status = p["status"]
            new_status = live.status
            if prev_status and new_status and prev_status != new_status:
                if prev_status == "online" and new_status != "online":
                    changes.append((username, "online_to_offline", prev_status, new_status))
                elif prev_status != "online" and new_status == "online":
                    changes.append((username, "offline_to_online", prev_status, new_status))
            if not p["dying_gasp"] and live.dying_gasp:
                changes.append((username, "dying_gasp", "", ""))
            if (p["binding_source"] or "") != binding_source and is_resolved and was_resolved:
                changes.append((username, "source_changed", p["binding_source"] or "", binding_source))
            if (p["confidence"] or "") != confidence and confidence != "guess":
                changes.append((username, "confidence_changed", p["confidence"] or "", confidence))
        else:
            # new row â€” emit "resolved" if positioned, "first_seen" otherwise
            if binding_source != "no_olt_match":
                changes.append((username, "resolved", "new", binding_source))

        # UPSERT
        db.execute(text("""
            INSERT INTO customer_dna (
                username, railwire_mac, sticker_optical_mac, sticker_serial, router_mac,
                olt_host, pon_port, onu_index, optical_mac,
                binding_source, confidence, railwire_to_optical_offset,
                status, rx_power_dbm, tx_power_dbm, temperature_c, voltage_mv,
                dying_gasp, polled_at, signal_label, fault_type, health_score,
                notes, unmatched_reason,
                link_status, linked_at, last_verified_at, unlink_reason,
                last_reconciled_at, updated_at
            ) VALUES (
                :u, :rw, :stk, :sser, :rmac,
                :olt, :port, :idx, :omac,
                :src, :conf, :off,
                :st, :rx, :tx, :tmp, :v,
                :gasp, :polled, :sig, :flt, :hs,
                :notes, :ur,
                :ls, :la, :lva, :ulr,
                :now, :now
            )
            ON CONFLICT (username) DO UPDATE SET
                railwire_mac=EXCLUDED.railwire_mac,
                sticker_optical_mac=EXCLUDED.sticker_optical_mac,
                sticker_serial=EXCLUDED.sticker_serial,
                router_mac=EXCLUDED.router_mac,
                olt_host=EXCLUDED.olt_host, pon_port=EXCLUDED.pon_port, onu_index=EXCLUDED.onu_index,
                optical_mac=EXCLUDED.optical_mac,
                binding_source=EXCLUDED.binding_source, confidence=EXCLUDED.confidence,
                railwire_to_optical_offset=EXCLUDED.railwire_to_optical_offset,
                status=EXCLUDED.status, rx_power_dbm=EXCLUDED.rx_power_dbm,
                tx_power_dbm=EXCLUDED.tx_power_dbm, temperature_c=EXCLUDED.temperature_c,
                voltage_mv=EXCLUDED.voltage_mv, dying_gasp=EXCLUDED.dying_gasp,
                polled_at=EXCLUDED.polled_at, signal_label=EXCLUDED.signal_label,
                fault_type=EXCLUDED.fault_type, health_score=EXCLUDED.health_score,
                notes=EXCLUDED.notes, unmatched_reason=EXCLUDED.unmatched_reason,
                link_status=EXCLUDED.link_status,
                linked_at=EXCLUDED.linked_at,
                last_verified_at=EXCLUDED.last_verified_at,
                unlink_reason=EXCLUDED.unlink_reason,
                last_reconciled_at=EXCLUDED.last_reconciled_at, updated_at=EXCLUDED.updated_at
        """), {
            "u": username, "rw": railwire, "stk": sticker,
            "sser": row.get("sticker_serial"), "rmac": _norm_mac(row.get("router_mac")),
            "olt": position.olt_host if position else None,
            "port": position.pon_port if position else None,
            "idx": position.onu_index if position else None,
            "omac": optical_mac, "src": binding_source, "conf": confidence, "off": offset,
            "st": live.status, "rx": live.rx_power_dbm, "tx": live.tx_power_dbm,
            "tmp": live.temperature_c, "v": live.voltage_mv,
            "gasp": live.dying_gasp, "polled": live.polled_at,
            "sig": _signal_label(live.rx_power_dbm), "flt": _fault_type(live),
            "hs": _health_score(live),
            "notes": None, "ur": unmatched_reason,
            "ls": link_status, "la": linked_at, "lva": last_verified_at, "ulr": unlink_reason,
            "now": now,
        })

    # â”€â”€ Orphan ONU detection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    # MACs in OLT PON MAC tables that didn't match any customer.
    orphan_payload: List[Dict[str, Any]] = []
    for mac, pos in unified.items():
        if mac in matched_macs:
            continue
        # Look up optical for this position (if any)
        opt = optical_all.get(pos)
        orphan_payload.append({
            "mac": mac.upper(),
            "olt": pos.olt_host,
            "port": pos.pon_port,
            "idx": pos.onu_index,
            "rx":  opt.rx_power_dbm if opt else None,
            "tx":  opt.tx_power_dbm if opt else None,
            "st":  opt.status if opt else None,
        })

    # Upsert orphans (refresh last_seen_at; set first_seen_at only on insert)
    if orphan_payload:
        db.execute(text("""
            INSERT INTO orphan_onus (
                mac_address, olt_host, pon_port, onu_index,
                rx_power_dbm, tx_power_dbm, status, first_seen_at, last_seen_at
            ) VALUES (
                :mac, :olt, :port, :idx, :rx, :tx, :st, :now, :now
            )
            ON CONFLICT (mac_address, olt_host) DO UPDATE SET
                pon_port = EXCLUDED.pon_port,
                onu_index = EXCLUDED.onu_index,
                rx_power_dbm = EXCLUDED.rx_power_dbm,
                tx_power_dbm = EXCLUDED.tx_power_dbm,
                status = EXCLUDED.status,
                last_seen_at = EXCLUDED.last_seen_at
        """), [{**p, "now": now} for p in orphan_payload])

    # Sweep stale orphans (not seen in 24h) â€” drop them
    db.execute(text("""
        DELETE FROM orphan_onus o
        WHERE EXISTS (
            SELECT 1 FROM customers c
            WHERE c.mac_address IS NOT NULL
              AND c.mac_address <> ''
              AND UPPER(c.mac_address) = UPPER(o.mac_address)
        )
        OR EXISTS (
            SELECT 1 FROM onu_bindings b
            WHERE b.is_active = TRUE
              AND b.mac_address IS NOT NULL
              AND b.mac_address <> ''
              AND UPPER(b.mac_address) = UPPER(o.mac_address)
        )
        OR EXISTS (
            SELECT 1 FROM customer_dna d
            WHERE d.link_status = 'linked'
              AND d.optical_mac IS NOT NULL
              AND d.optical_mac <> ''
              AND UPPER(d.optical_mac) = UPPER(o.mac_address)
        )
    """))
    db.execute(text("DELETE FROM orphan_onus WHERE last_seen_at < NOW() - INTERVAL '24 hours'"))

    # Slot-occupancy tracking + device-swap detection. Runs against `unified`
    # (every MAC seen on a healthy OLT this cycle). Raises binding_alerts +
    # activity events the moment a slot's identity changes â€” closes the
    # "1 day customer is unknown after device swap" gap.
    try:
        with db.begin_nested():
            slot_stats = slot_occupancy.record_and_detect_swaps(
                db, unified=unified, olts_with_data=olts_with_data, now=now,
            )
        logger.info(
            "slot_occupancy: seen=%d new=%d refreshed=%d swaps=%d",
            slot_stats["seen"], slot_stats["new_slots"],
            slot_stats["refreshed_slots"], slot_stats["swaps_detected"],
        )
    except Exception as e:
        logger.exception("slot_occupancy.record_and_detect_swaps failed: %s", e)
        slot_stats = {"seen": 0, "new_slots": 0, "refreshed_slots": 0, "swaps_detected": 0}

    # Bulk-insert state changes
    if changes:
        db.execute(text("""
            INSERT INTO engine_state_changes (occurred_at, run_id, username, change_type, from_value, to_value)
            VALUES (:t, :run, :u, :ct, :fv, :tv)
        """), [
            {"t": now, "run": run_id, "u": u, "ct": ct, "fv": fv, "tv": tv}
            for (u, ct, fv, tv) in changes
        ])

        # Mirror the important changes into activity_events so the unified
        # /pipeline activity feed shows them too. We keep this filter narrow â€”
        # confidence_changed / source_changed flood the feed every cycle and
        # aren't actionable, so they stay in engine_state_changes only.
        _ACTIVITY_INTEREST = {
            "resolved":          ("binding.resolved",          SEVERITY_INFO),
            "unresolved":        ("binding.unresolved",        SEVERITY_WARNING),
            "position_changed":  ("binding.position_changed",  SEVERITY_WARNING),
            "online_to_offline": ("binding.online_to_offline", SEVERITY_WARNING),
            "offline_to_online": ("binding.offline_to_online", SEVERITY_INFO),
            "dying_gasp":        ("binding.dying_gasp",        SEVERITY_WARNING),
        }
        for (u, ct, fv, tv) in changes:
            mapped = _ACTIVITY_INTEREST.get(ct)
            if not mapped:
                continue
            category, sev = mapped
            activity_emit(
                db,
                category=category,
                severity=sev,
                actor="engine_reconcile",
                customer_username=u,
                summary=f"{u}: {ct} ({fv or '-'} â†’ {tv or '-'})",
                payload={"from": fv, "to": tv, "run_id": run_id},
            )

    # Finalize run row. Tall per-OLT stats go to engine_reconcile_olt_stats
    # (works for any number of OLTs). The legacy wide columns are populated for
    # the 3 known hosts so the existing engine UI keeps working unchanged.
    duration = time.time() - t0

    # Tall stats â€” one row per OLT we attempted this cycle.
    stats_rows = []
    for olt in olt_hosts:
        stats_rows.append({
            "run": run_id,
            "olt": olt,
            "pm":  pon_mac_stats.get(olt),
            "op":  optical_stats.get(olt),
            "err": olt_errors.get(f"{olt} pon_mac") or olt_errors.get(f"{olt} optical") or olt_errors.get(f"{olt} precheck"),
        })
    if stats_rows:
        db.execute(text("""
            INSERT INTO engine_reconcile_olt_stats (run_id, olt_host, pon_mac_count, optical_count, walk_error)
            VALUES (:run, :olt, :pm, :op, :err)
            ON CONFLICT (run_id, olt_host) DO UPDATE SET
                pon_mac_count = EXCLUDED.pon_mac_count,
                optical_count = EXCLUDED.optical_count,
                walk_error    = EXCLUDED.walk_error
        """), stats_rows)

    db.execute(text("""
        UPDATE engine_reconcile_runs SET
            finished_at = :f, duration_seconds = :d, ok = TRUE,
            customers_total = :ct, customers_resolved = :cr, customers_unmatched = :cu,
            unified_mac_count = :um, changes_count = :ch,
            olt_100_pon_mac = :o1p, olt_100_optical = :o1o, olt_100_error = :o1e,
            olt_200_pon_mac = :o2p, olt_200_optical = :o2o, olt_200_error = :o2e,
            olt_210_pon_mac = :o3p, olt_210_optical = :o3o, olt_210_error = :o3e
        WHERE id = :id
    """), {
        "id": run_id, "f": datetime.now(timezone.utc), "d": round(duration, 2),
        "ct": len(customers), "cr": sum(1 for k, v in resolved_by_source.items() if k != "no_olt_match" for _ in range(v)),
        "cu": resolved_by_source.get("no_olt_match", 0),
        "um": len(unified), "ch": len(changes),
        "o1p": pon_mac_stats.get("10.10.10.100"), "o1o": optical_stats.get("10.10.10.100"),
        "o1e": olt_errors.get("10.10.10.100 pon_mac") or olt_errors.get("10.10.10.100 optical"),
        "o2p": pon_mac_stats.get("10.10.10.200"), "o2o": optical_stats.get("10.10.10.200"),
        "o2e": olt_errors.get("10.10.10.200 pon_mac") or olt_errors.get("10.10.10.200 optical"),
        "o3p": pon_mac_stats.get("10.10.10.210"), "o3o": optical_stats.get("10.10.10.210"),
        "o3e": olt_errors.get("10.10.10.210 pon_mac") or olt_errors.get("10.10.10.210 optical"),
    })
    db.commit()

    # â”€â”€ Profile enrichment â€” copy engine-derived position/serial/model back to
    # the customers table so the admin UI / mobile briefing card shows the
    # OLT-known truth (was empty before this enrichment).
    try:
        enr = customer_profile_enricher.enrich_all(db, force=False)
        if enr.fields_filled > 0:
            logger.info(
                "profile_enricher: %d fields filled across %d customers",
                enr.fields_filled, enr.rows_enriched,
            )
    except Exception as e:
        logger.exception("profile_enricher failed: %s", e)

    snmp_runner.close()

    return {
        "run_id": run_id,
        "pon_mac_table_entries_per_olt": pon_mac_stats,
        "optical_entries_per_olt": optical_stats,
        "unified_mac_count": len(unified),
        "customers_total": len(customers),
        "resolved_by_source": resolved_by_source,
        "unmatched_reasons": unmatched_reasons,
        "changes_count": len(changes),
        "olt_errors": olt_errors,
        "duration_seconds": round(duration, 2),
        "ran_at": now.isoformat(),
    }


# â”€â”€â”€ Per-customer resolve (manual "Re-link now") â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def resolve_one(db: Session, username: str) -> Dict[str, Any]:
    """Walk all 3 OLT PON MAC tables + optical tables for ONE customer.

    Used by the "Re-link" button on the monitor's unmatched list. Faster than
    a full reconcile (we still walk full tables â€” that's how SNMP works â€” but
    we only update one customer_dna row).
    """
    cust = db.execute(text("""
        SELECT username, mac_address AS railwire_mac_raw,
               router_mac_address AS router_mac,
               ont_serial_number AS sticker_serial,
               ont_sticker_data
        FROM customers
        WHERE username = :u
    """), {"u": username}).mappings().first()
    if not cust:
        return {"ok": False, "error": "customer not found"}

    railwire_raw = cust["railwire_mac_raw"]
    railwire = _norm_mac(railwire_raw)
    sticker = None
    sd = cust.get("ont_sticker_data") or {}
    if isinstance(sd, dict):
        sticker = _norm_mac(sd.get("macAddress"))

    # Prime registry cache and walk all registered OLTs
    olt_hosts = [c.host for c in olt_registry.list_active(db)] or get_all_olt_hosts()

    unified: Dict[str, Position] = {}
    optical_all: Dict[Position, OpticalData] = {}
    olts_walked: Dict[str, int] = {}
    olts_failed: List[str] = []

    for olt in olt_hosts:
        pma = get_pon_mac_adapter(olt)
        if not pma: continue
        try:
            m = pma.walk_pon_mac_table()
            unified.update(m)
            olts_walked[olt] = len(m)
            if len(m) == 0:
                olts_failed.append(olt)
        except Exception as e:
            olts_walked[olt] = 0
            olts_failed.append(olt)
            logger.warning("resolve_one: %s walk failed: %s", olt, e)

    for olt in olt_hosts:
        oa = _optical_adapter_for(olt)
        if not oa: continue
        try:
            optical_all.update(oa.walk_optical_table())
        except Exception:
            pass

    # Pull this customer's previous DNA + binding fallback
    p_row = db.execute(text("""
        SELECT olt_host, pon_port, onu_index, optical_mac, binding_source, confidence, status, dying_gasp
        FROM customer_dna WHERE username = :u
    """), {"u": username}).mappings().first()
    p = dict(p_row) if p_row else {}

    fb_row = db.execute(text("""
        SELECT olt_host, pon_port, onu_index, mac_address
        FROM onu_bindings
        WHERE customer_id = :u AND is_active = TRUE
              AND olt_host IS NOT NULL AND onu_index IS NOT NULL
        ORDER BY verified_at DESC NULLS LAST LIMIT 1
    """), {"u": username}).mappings().first()
    fb = dict(fb_row) if fb_row else {}

    # Apply same rules as reconcile_all
    position: Optional[Position] = None
    binding_source = "no_olt_match"
    confidence = "guess"
    offset = None
    optical_mac = None

    if sticker and sticker in unified:
        position = unified[sticker]
        optical_mac = sticker
        binding_source = "sticker_scan"
        confidence = "verified"
        if railwire:
            offset = int(sticker.split(":")[-1], 16) - int(railwire.split(":")[-1], 16)
    elif railwire and railwire in unified:
        position = unified[railwire]
        optical_mac = railwire
        binding_source = "pon_mac_table"
        confidence = "verified"
        offset = 0

    if binding_source == "no_olt_match":
        prev_olt  = p.get("olt_host")  or fb.get("olt_host")
        prev_port = p.get("pon_port")  or fb.get("pon_port")
        prev_idx  = p.get("onu_index") if p.get("onu_index") is not None else fb.get("onu_index")
        prev_optical_mac = p.get("optical_mac") or fb.get("mac_address")
        prev_source = p.get("binding_source") or ""
        if prev_olt and prev_port and prev_idx is not None:
            olt_failed_this_cycle = prev_olt in olts_failed
            had_verified_prev = prev_source in ("pon_mac_table", "sticker_scan", "stale_pon_mac")
            had_fallback = bool(fb.get("olt_host"))
            if olt_failed_this_cycle or had_verified_prev or had_fallback:
                position = Position(prev_olt, prev_port, int(prev_idx))
                optical_mac = prev_optical_mac
                binding_source = "stale_pon_mac"
                confidence = "verified" if prev_source == "sticker_scan" else "probable"

    live = optical_all.get(position) if position else OpticalData()
    if live is None: live = OpticalData()

    unmatched_reason = None
    if binding_source == "no_olt_match":
        unmatched_reason = _categorize_unmatched(railwire_raw, railwire, position,
                                                 optical_present=(live.rx_power_dbm is not None))
    elif binding_source == "stale_pon_mac":
        unmatched_reason = "held_offline"

    now = datetime.now(timezone.utc)
    db.execute(text("""
        INSERT INTO customer_dna (
            username, railwire_mac, sticker_optical_mac, sticker_serial, router_mac,
            olt_host, pon_port, onu_index, optical_mac,
            binding_source, confidence, railwire_to_optical_offset,
            status, rx_power_dbm, tx_power_dbm, temperature_c, voltage_mv,
            dying_gasp, polled_at, signal_label, fault_type, health_score,
            notes, unmatched_reason, last_reconciled_at, updated_at
        ) VALUES (
            :u, :rw, :stk, :sser, :rmac,
            :olt, :port, :idx, :omac,
            :src, :conf, :off,
            :st, :rx, :tx, :tmp, :v,
            :gasp, :polled, :sig, :flt, :hs,
            :notes, :ur, :now, :now
        )
        ON CONFLICT (username) DO UPDATE SET
            railwire_mac=EXCLUDED.railwire_mac,
            sticker_optical_mac=EXCLUDED.sticker_optical_mac,
            sticker_serial=EXCLUDED.sticker_serial,
            router_mac=EXCLUDED.router_mac,
            olt_host=EXCLUDED.olt_host, pon_port=EXCLUDED.pon_port, onu_index=EXCLUDED.onu_index,
            optical_mac=EXCLUDED.optical_mac,
            binding_source=EXCLUDED.binding_source, confidence=EXCLUDED.confidence,
            railwire_to_optical_offset=EXCLUDED.railwire_to_optical_offset,
            status=EXCLUDED.status, rx_power_dbm=EXCLUDED.rx_power_dbm,
            tx_power_dbm=EXCLUDED.tx_power_dbm, temperature_c=EXCLUDED.temperature_c,
            voltage_mv=EXCLUDED.voltage_mv, dying_gasp=EXCLUDED.dying_gasp,
            polled_at=EXCLUDED.polled_at, signal_label=EXCLUDED.signal_label,
            fault_type=EXCLUDED.fault_type, health_score=EXCLUDED.health_score,
            notes=EXCLUDED.notes, unmatched_reason=EXCLUDED.unmatched_reason,
            last_reconciled_at=EXCLUDED.last_reconciled_at, updated_at=EXCLUDED.updated_at
    """), {
        "u": username, "rw": railwire, "stk": sticker,
        "sser": cust.get("sticker_serial"), "rmac": _norm_mac(cust.get("router_mac")),
        "olt": position.olt_host if position else None,
        "port": position.pon_port if position else None,
        "idx": position.onu_index if position else None,
        "omac": optical_mac, "src": binding_source, "conf": confidence, "off": offset,
        "st": live.status, "rx": live.rx_power_dbm, "tx": live.tx_power_dbm,
        "tmp": live.temperature_c, "v": live.voltage_mv,
        "gasp": live.dying_gasp, "polled": live.polled_at,
        "sig": _signal_label(live.rx_power_dbm), "flt": _fault_type(live),
        "hs": _health_score(live),
        "notes": None, "ur": unmatched_reason, "now": now,
    })
    db.commit()
    snmp_runner.close()

    return {
        "ok": True,
        "username": username,
        "binding_source": binding_source,
        "confidence": confidence,
        "position": f"{position.olt_host}/{position.pon_port}/{position.onu_index}" if position else None,
        "optical_mac": optical_mac,
        "unmatched_reason": unmatched_reason,
        "rx_power_dbm": live.rx_power_dbm,
        "status": live.status,
        "olts_walked": olts_walked,
        "olts_failed": olts_failed,
    }


# â”€â”€â”€ Read APIs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

_DNA_COLS = ", ".join([
    "username", "railwire_mac", "sticker_optical_mac", "sticker_serial", "router_mac",
    "olt_host", "pon_port", "onu_index", "optical_mac", "optical_serial",
    "binding_source", "confidence", "railwire_to_optical_offset",
    "status", "rx_power_dbm", "tx_power_dbm", "temperature_c", "voltage_mv",
    "dying_gasp", "polled_at",
    "signal_label", "fault_type", "health_score", "notes", "unmatched_reason",
    "last_reconciled_at", "updated_at",
])


def get_dna(db: Session, username: str) -> Optional[Dict[str, Any]]:
    row = db.execute(text(f"SELECT {_DNA_COLS} FROM customer_dna WHERE username=:u"),
                     {"u": username}).mappings().first()
    if not row:
        return None
    dna = dict(row)
    live = db.execute(text("""
        SELECT ol.mac_address, ol.olt_host, ol.pon_port, ol.onu_index,
               ol.status, ol.rx_power_dbm, ol.tx_power_dbm, ol.temperature_c,
               ol.voltage_mv, ol.dying_gasp, ol.polled_at
        FROM onu_bindings b
        JOIN onu_latest ol
          ON UPPER(ol.mac_address) IN (
              UPPER(b.onu_identifier),
              UPPER(b.mac_address),
              UPPER(b.serial_number),
              CASE
                  WHEN b.serial_number IS NOT NULL AND b.serial_number <> ''
                  THEN 'SN:' || UPPER(b.serial_number)
                  ELSE NULL
              END
          )
        WHERE b.customer_id = :u
          AND b.is_active = TRUE
          AND ol.polled_at > NOW() - INTERVAL '10 minutes'
        ORDER BY
          CASE COALESCE(LOWER(b.confidence), '')
              WHEN 'verified' THEN 3
              WHEN 'probable' THEN 2
              ELSE 1
          END DESC,
          ol.polled_at DESC
        LIMIT 1
    """), {"u": username}).mappings().first()
    if live:
        dna.update({
            "optical_mac": live["mac_address"],
            "olt_host": live["olt_host"],
            "pon_port": live["pon_port"],
            "onu_index": live["onu_index"],
            "status": live["status"],
            "rx_power_dbm": live["rx_power_dbm"],
            "tx_power_dbm": live["tx_power_dbm"],
            "temperature_c": live["temperature_c"],
            "voltage_mv": live["voltage_mv"],
            "dying_gasp": live["dying_gasp"],
            "polled_at": live["polled_at"],
            "signal_label": _signal_label(live["rx_power_dbm"]),
            "fault_type": _fault_type(OpticalData(
                status=live["status"],
                rx_power_dbm=live["rx_power_dbm"],
                tx_power_dbm=live["tx_power_dbm"],
                temperature_c=live["temperature_c"],
                voltage_mv=live["voltage_mv"],
                dying_gasp=live["dying_gasp"],
                polled_at=live["polled_at"],
            )),
            "health_score": _health_score(OpticalData(
                status=live["status"],
                rx_power_dbm=live["rx_power_dbm"],
                tx_power_dbm=live["tx_power_dbm"],
                temperature_c=live["temperature_c"],
                voltage_mv=live["voltage_mv"],
                dying_gasp=live["dying_gasp"],
                polled_at=live["polled_at"],
            )),
        })
    return dna


def get_status_summary(db: Session) -> Dict[str, Any]:
    """Overall counters + reason breakdown + per-OLT distribution + per-OLT ONU stats."""
    rows = db.execute(text("""
        SELECT
          COUNT(*)                                                AS total,
          COUNT(*) FILTER (WHERE link_status = 'linked')          AS linked,
          COUNT(*) FILTER (WHERE link_status = 'unlinked')        AS unlinked,
          COUNT(*) FILTER (WHERE last_verified_at IS NOT NULL)    AS freshly_verified,
          COUNT(*) FILTER (WHERE binding_source != 'no_olt_match') AS resolved,
          COUNT(*) FILTER (WHERE binding_source = 'sticker_scan')  AS sticker_scan,
          COUNT(*) FILTER (WHERE binding_source = 'pon_mac_table') AS pon_mac_table,
          COUNT(*) FILTER (WHERE binding_source = 'stale_pon_mac') AS stale_pon_mac,
          COUNT(*) FILTER (WHERE binding_source = 'no_olt_match')  AS no_olt_match,
          COUNT(*) FILTER (WHERE confidence = 'verified')          AS verified,
          COUNT(*) FILTER (WHERE confidence = 'probable')          AS probable,
          COUNT(*) FILTER (WHERE confidence = 'guess')             AS guess,
          COUNT(*) FILTER (WHERE status = 'online')                AS online_now,
          COUNT(*) FILTER (WHERE status = 'offline')               AS offline_now,
          COUNT(*) FILTER (WHERE dying_gasp = TRUE)                AS dying_gasp,
          MAX(last_reconciled_at)                                  AS last_reconciled_at
        FROM customer_dna
    """)).mappings().first()

    # Per-OLT: how many customers linked here, freshly-verified vs held
    by_olt_rows = db.execute(text("""
        SELECT olt_host,
               COUNT(*)                                                  AS total_customers,
               COUNT(*) FILTER (WHERE link_status = 'linked')            AS linked,
               COUNT(*) FILTER (WHERE last_verified_at >= NOW() - INTERVAL '20 minutes')  AS fresh_in_20min,
               COUNT(*) FILTER (WHERE binding_source = 'pon_mac_table')  AS live_now,
               COUNT(*) FILTER (WHERE binding_source = 'stale_pon_mac')  AS held_offline,
               COUNT(*) FILTER (WHERE binding_source = 'sticker_scan')   AS sticker_scan
        FROM customer_dna
        WHERE olt_host IS NOT NULL
        GROUP BY olt_host ORDER BY olt_host
    """)).mappings().all()

    # Orphan ONU counts per OLT
    orphan_rows = db.execute(text("""
        SELECT olt_host, COUNT(*) AS orphans
        FROM orphan_onus
        WHERE last_seen_at >= NOW() - INTERVAL '24 hours'
        GROUP BY olt_host
    """)).mappings().all()
    orphan_by_olt = {r["olt_host"]: r["orphans"] for r in orphan_rows}

    # Pull last COMPLETED run's per-OLT walk results. We deliberately skip
    # in-progress runs (finished_at IS NULL) â€” those show 0/0/0 mid-flight
    # and would falsely make every OLT look "silent" in the UI.
    last_run = db.execute(text("""
        SELECT olt_100_pon_mac, olt_200_pon_mac, olt_210_pon_mac,
               olt_100_optical, olt_200_optical, olt_210_optical,
               olt_100_error,   olt_200_error,   olt_210_error,
               started_at, finished_at
        FROM engine_reconcile_runs
        WHERE finished_at IS NOT NULL
        ORDER BY finished_at DESC LIMIT 1
    """)).mappings().first()

    walk_by_olt: Dict[str, Dict[str, Any]] = {}
    if last_run:
        walk_by_olt = {
            "10.10.10.100": {
                "pon_mac_count": last_run["olt_100_pon_mac"],
                "optical_count": last_run["olt_100_optical"],
                "error": last_run["olt_100_error"],
            },
            "10.10.10.200": {
                "pon_mac_count": last_run["olt_200_pon_mac"],
                "optical_count": last_run["olt_200_optical"],
                "error": last_run["olt_200_error"],
            },
            "10.10.10.210": {
                "pon_mac_count": last_run["olt_210_pon_mac"],
                "optical_count": last_run["olt_210_optical"],
                "error": last_run["olt_210_error"],
            },
        }

    olts_full: List[Dict[str, Any]] = []
    seen_hosts = {r["olt_host"] for r in by_olt_rows}
    for r in by_olt_rows:
        host = r["olt_host"]
        walk = walk_by_olt.get(host, {})
        macs = walk.get("pon_mac_count") or 0
        live = r["live_now"] or 0
        held = r["held_offline"] or 0
        sticker = r["sticker_scan"] or 0
        olts_full.append({
            "olt_host":       host,
            "customers":      r["total_customers"],
            "linked":         r["linked"] or 0,
            "fresh_in_20min": r["fresh_in_20min"] or 0,
            "live_now":       live,
            "held_offline":   held,
            "sticker_scan":   sticker,
            "pon_mac_count":  macs,
            "optical_count":  walk.get("optical_count"),
            "orphan_macs":    orphan_by_olt.get(host, 0),
            "walk_error":     walk.get("error"),
        })
    # Include hosts that appear in last run but have no customers in customer_dna
    for host, w in walk_by_olt.items():
        if host in seen_hosts: continue
        olts_full.append({
            "olt_host":      host,
            "customers":     0,
            "live_now":      0,
            "held_offline":  0,
            "sticker_scan":  0,
            "pon_mac_count": w.get("pon_mac_count"),
            "optical_count": w.get("optical_count"),
            "orphan_macs":   w.get("pon_mac_count") or 0,
            "walk_error":    w.get("error"),
        })
    olts_full.sort(key=lambda x: x["olt_host"])

    reasons = db.execute(text("""
        SELECT unmatched_reason, COUNT(*) AS cnt
        FROM customer_dna
        WHERE unmatched_reason IS NOT NULL
        GROUP BY unmatched_reason
        ORDER BY cnt DESC
    """)).mappings().all()

    # Keep legacy 'by_olt' shape so existing UI keeps working
    by_olt = [{"olt_host": o["olt_host"], "cnt": o["customers"]} for o in olts_full]

    return {
        **dict(rows or {}),
        "by_olt": by_olt,
        "olts": olts_full,
        "unmatched_reasons": [dict(r) for r in reasons],
    }


def get_recent_runs(db: Session, limit: int = 20) -> List[Dict[str, Any]]:
    rows = db.execute(text("""
        SELECT id, started_at, finished_at, duration_seconds, ok, error,
               customers_total, customers_resolved, customers_unmatched,
               unified_mac_count, changes_count,
               olt_100_pon_mac, olt_100_optical, olt_100_error,
               olt_200_pon_mac, olt_200_optical, olt_200_error,
               olt_210_pon_mac, olt_210_optical, olt_210_error
        FROM engine_reconcile_runs
        ORDER BY started_at DESC LIMIT :n
    """), {"n": limit}).mappings().all()
    return [dict(r) for r in rows]


def get_orphan_onus(db: Session, olt_host: Optional[str] = None, limit: int = 500) -> List[Dict[str, Any]]:
    """ONUs the OLT sees but no Railwire customer claims."""
    sql = """
        SELECT mac_address, olt_host, pon_port, onu_index,
               rx_power_dbm, tx_power_dbm, status,
               first_seen_at, last_seen_at, notes
        FROM orphan_onus
        WHERE last_seen_at >= NOW() - INTERVAL '24 hours'
    """
    params: Dict[str, Any] = {"n": min(max(1, limit), 2000)}
    if olt_host:
        sql += " AND olt_host = :olt"
        params["olt"] = olt_host
    sql += " ORDER BY olt_host, pon_port, onu_index LIMIT :n"
    rows = db.execute(text(sql), params).mappings().all()
    return [dict(r) for r in rows]


def get_recent_changes(db: Session, limit: int = 50, change_type: Optional[str] = None,
                       username: Optional[str] = None) -> List[Dict[str, Any]]:
    sql = """
        SELECT id, occurred_at, run_id, username, change_type, from_value, to_value, note
        FROM engine_state_changes
        WHERE TRUE
    """
    params: Dict[str, Any] = {"n": limit}
    if change_type:
        sql += " AND change_type = :ct"
        params["ct"] = change_type
    if username:
        sql += " AND username = :u"
        params["u"] = username
    sql += " ORDER BY occurred_at DESC LIMIT :n"
    rows = db.execute(text(sql), params).mappings().all()
    return [dict(r) for r in rows]
