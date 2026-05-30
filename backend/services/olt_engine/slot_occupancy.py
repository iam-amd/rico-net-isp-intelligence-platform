"""Slot-occupancy tracker — the anchor for device-swap detection.

The OLT slot (olt_host + pon_port + onu_index) is the most stable identity
in the whole system. The MAC at that slot changes when:
  - The customer replaces their ONU device (most common)
  - A technician swaps an ONU between two customers
  - A splitter is rewired (rare — usually changes pon_port, not the slot)

By recording who lives in each slot over time, we can detect a device
swap within one engine cycle (≤10 min) instead of waiting hours/days for
a CSR to update the Railwire MAC.

Strategy:
  1. After each engine cycle, for every (olt, port, index, mac) seen this
     cycle: UPSERT into slot_occupancy_history. The unique key is
     (olt, port, index, mac), so seeing the SAME mac at the SAME slot just
     refreshes last_seen_at.
  2. For each slot where the CURRENT mac differs from any other still-open
     row at the same slot: close the older row (vacated_at = now) and
     emit a device_swap event + binding_alert.
  3. We only write occupancy for OLTs that walked successfully this cycle
     (`olts_with_data`). Otherwise a transient SNMP failure would falsely
     "vacate" every slot on that OLT.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Dict, Iterable, List, Optional, Set, Tuple

from sqlalchemy import text
from sqlalchemy.orm import Session

from .types import Position
from ..activity_log import emit as activity_emit, SEVERITY_CRITICAL, SEVERITY_INFO

logger = logging.getLogger("rico_net.olt_engine.slot_occupancy")

# A real device swap is a small, rare event. If a reconcile sees many slots
# changing at once, it is usually baseline/history churn, an OLT table semantics
# change, or a parser/filter correction. Suppress alerts so operators do not get
# a fake critical incident storm.
MAX_SWAP_ALERTS_PER_CYCLE = 25


def record_and_detect_swaps(
    db: Session,
    *,
    unified: Dict[str, Position],
    olts_with_data: Set[str],
    now: datetime,
) -> Dict[str, int]:
    """Update slot_occupancy_history and detect device swaps in one pass.

    Returns counters: {seen, new_slots, refreshed_slots, swaps_detected}.
    Safe to call inside an open transaction; doesn't commit on its own.
    """
    counters = {
        "seen": 0,
        "new_slots": 0,
        "refreshed_slots": 0,
        "swaps_detected": 0,
    }

    if not olts_with_data:
        logger.info("slot_occupancy: no OLTs walked successfully — skipping update")
        return counters

    # Filter to only OLTs that actually walked this cycle. We must not touch
    # slots on OLTs that timed out — they'd appear "vacated" until next cycle.
    live_slots: List[Tuple[str, str, int, str]] = []  # (olt, port, idx, mac_upper)
    for mac, pos in unified.items():
        if not mac or not pos:
            continue
        if pos.olt_host not in olts_with_data:
            continue
        mac_u = mac.upper().strip()
        if not mac_u:
            continue
        live_slots.append((pos.olt_host, pos.pon_port, int(pos.onu_index), mac_u))

    counters["seen"] = len(live_slots)

    if not live_slots:
        return counters

    # Bulk upsert — refreshes last_seen_at, bumps sample_count.
    upserts = [
        {
            "olt": olt, "port": port, "idx": idx, "mac": mac,
            "now": now,
        }
        for (olt, port, idx, mac) in live_slots
    ]

    # SQLAlchemy doesn't return RETURNING rows when the parameter set is
    # a list (executemany). Drop the RETURNING; we don't need precise
    # new-vs-refresh counts here. The swap detector below uses
    # slot_occupancy_history directly.
    for chunk_start in range(0, len(upserts), 500):
        chunk = upserts[chunk_start:chunk_start + 500]
        db.execute(text("""
            INSERT INTO slot_occupancy_history
                (olt_host, pon_port, onu_index, optical_mac,
                 first_seen_at, last_seen_at, sample_count)
            VALUES
                (:olt, :port, :idx, :mac, :now, :now, 1)
            ON CONFLICT (olt_host, pon_port, onu_index, optical_mac) DO UPDATE
            SET last_seen_at = EXCLUDED.last_seen_at,
                sample_count = slot_occupancy_history.sample_count + 1,
                vacated_at   = NULL,
                first_seen_at = CASE
                    WHEN slot_occupancy_history.vacated_at IS NOT NULL
                    THEN EXCLUDED.first_seen_at
                    ELSE slot_occupancy_history.first_seen_at
                END
        """), chunk)

    counters["new_slots"] = 0  # not tracked anymore; check via slot_occupancy_history directly
    counters["refreshed_slots"] = len(live_slots)

    # Detect swaps: any slot where there are 2+ open rows means the slot's MAC
    # changed AND we just inserted a new one. Close the OLDER ones (those with
    # the older last_seen_at) and raise alerts.
    swap_rows = db.execute(text("""
        WITH live_olts AS (
            SELECT UNNEST(:olts) AS olt
        ),
        slots AS (
            SELECT olt_host, pon_port, onu_index,
                   COUNT(*) AS occupant_count
            FROM slot_occupancy_history
            WHERE olt_host IN (SELECT olt FROM live_olts)
              AND vacated_at IS NULL
            GROUP BY olt_host, pon_port, onu_index
            HAVING COUNT(*) > 1
        )
        SELECT s.olt_host, s.pon_port, s.onu_index,
               sh.id            AS row_id,
               sh.optical_mac,
               sh.first_seen_at,
               sh.last_seen_at
        FROM slots s
        JOIN slot_occupancy_history sh
          ON sh.olt_host = s.olt_host
         AND sh.pon_port = s.pon_port
         AND sh.onu_index = s.onu_index
         AND sh.vacated_at IS NULL
        ORDER BY s.olt_host, s.pon_port, s.onu_index, sh.last_seen_at DESC
    """), {"olts": list(olts_with_data)}).mappings().all()

    if not swap_rows:
        return counters

    # Group rows per slot. The newest (last_seen_at DESC head) is the current
    # occupant; older ones get vacated.
    by_slot: Dict[Tuple[str, str, int], List[Dict]] = {}
    for r in swap_rows:
        key = (r["olt_host"], r["pon_port"], r["onu_index"])
        by_slot.setdefault(key, []).append(dict(r))

    rows_to_vacate: List[int] = []
    swap_events: List[Tuple[str, str, int, str, str]] = []  # (olt, port, idx, old_mac, new_mac)
    for (olt, port, idx), occupants in by_slot.items():
        if len(occupants) < 2:
            continue
        current = occupants[0]   # newest
        for older in occupants[1:]:
            rows_to_vacate.append(older["row_id"])
            swap_events.append((
                olt, port, int(idx),
                older["optical_mac"], current["optical_mac"]
            ))

    if rows_to_vacate:
        db.execute(text("""
            UPDATE slot_occupancy_history
            SET vacated_at = :now
            WHERE id = ANY(:ids)
        """), {"ids": rows_to_vacate, "now": now})

    counters["swaps_detected"] = len(swap_events)

    if len(swap_events) > MAX_SWAP_ALERTS_PER_CYCLE:
        logger.warning(
            "slot_occupancy: suppressing %d swap alert(s); exceeds per-cycle guard %d",
            len(swap_events),
            MAX_SWAP_ALERTS_PER_CYCLE,
        )
        return counters

    # Activity log + binding alerts for each swap. The drift monitor will
    # follow up later, but we want IMMEDIATE visibility on slot identity change.
    for olt, port, idx, old_mac, new_mac in swap_events:
        # Look up the prior customer (had a verified binding at this slot)
        prior_cust = _lookup_customer_at_slot(db, olt, port, idx, old_mac)
        new_mac_orphan = _is_orphan(db, new_mac, olt)

        summary = (
            f"Device swap at {olt} port={port} index={idx}: "
            f"{old_mac} replaced by {new_mac}"
        )
        suggested_action = None
        severity = SEVERITY_CRITICAL
        if prior_cust and new_mac_orphan:
            suggested_action = (
                f"Confirm device swap: bind customer {prior_cust} to new MAC "
                f"{new_mac} (replaces old MAC {old_mac}). "
                f"If correct, click Confirm — system will create verified binding."
            )
        elif prior_cust:
            suggested_action = (
                f"Old MAC was bound to {prior_cust}; new MAC {new_mac} appears "
                f"already claimed by another customer. Manual review needed — "
                f"may be a duplicate assignment."
            )
        else:
            suggested_action = (
                f"Slot identity changed but no prior customer was bound. "
                f"Verify this is the expected occupant."
            )

        # Dedup key: never re-alert the same swap pair while open.
        dedup = f"swap:{olt}:{port}:{idx}:{old_mac}:{new_mac}"

        db.execute(text("""
            INSERT INTO binding_alerts
                (category, severity, summary, suggested_action,
                 customer_username, olt_host, pon_port, onu_index,
                 current_state, dedup_key, status)
            VALUES
                ('device_swap_detected', :severity, :summary, :action,
                 :cust, :olt, :port, :idx,
                 CAST(:state AS JSONB), :dedup, 'open')
            ON CONFLICT (dedup_key) WHERE status = 'open' AND dedup_key IS NOT NULL DO NOTHING
        """), {
            "severity": severity,
            "summary": summary,
            "action": suggested_action,
            "cust": prior_cust,
            "olt": olt,
            "port": port,
            "idx": idx,
            "state": _jsonable({
                "old_mac": old_mac,
                "new_mac": new_mac,
                "new_mac_is_orphan": new_mac_orphan,
                "prior_customer": prior_cust,
            }),
            "dedup": dedup,
        })

        activity_emit(
            db,
            category="binding.device_swap_detected",
            severity=SEVERITY_CRITICAL,
            actor="engine_reconcile",
            customer_username=prior_cust,
            summary=summary,
            payload={
                "olt": olt, "port": port, "idx": idx,
                "old_mac": old_mac, "new_mac": new_mac,
                "new_mac_is_orphan": new_mac_orphan,
            },
        )

    if swap_events:
        logger.warning(
            "slot_occupancy: detected %d device swap(s) this cycle",
            len(swap_events),
        )

    return counters


def _lookup_customer_at_slot(
    db: Session, olt: str, port: str, idx: int, mac: str
) -> Optional[str]:
    """Find the customer most recently bound to this slot+MAC.

    Checks customer_dna first (current truth), falls back to onu_bindings.
    Returns the username or None.
    """
    # 1) Current DNA pointing at this slot with this MAC
    row = db.execute(text("""
        SELECT username FROM customer_dna
        WHERE olt_host = :olt
          AND pon_port = :port
          AND onu_index = :idx
          AND UPPER(COALESCE(optical_mac, '')) = :mac
        LIMIT 1
    """), {"olt": olt, "port": port, "idx": int(idx), "mac": mac.upper()}).fetchone()
    if row:
        return row[0]

    # 2) Maybe DNA already moved on; check onu_bindings (active, by mac)
    row = db.execute(text("""
        SELECT c.username
        FROM onu_bindings b
        JOIN customers c ON c.username = b.customer_id
        WHERE b.is_active = TRUE
          AND b.olt_host = :olt
          AND b.pon_port = :port
          AND b.onu_index = :idx
          AND UPPER(COALESCE(b.mac_address, '')) = :mac
        LIMIT 1
    """), {"olt": olt, "port": port, "idx": int(idx), "mac": mac.upper()}).fetchone()
    if row:
        return row[0]

    # 3) Customer with this Railwire MAC, regardless of slot
    row = db.execute(text("""
        SELECT username FROM customers
        WHERE UPPER(COALESCE(mac_address, '')) = :mac
        LIMIT 1
    """), {"mac": mac.upper()}).fetchone()
    if row:
        return row[0]

    return None


def _is_orphan(db: Session, mac: str, olt: str) -> bool:
    """True if MAC is currently in orphan_onus (no customer has claimed it)."""
    row = db.execute(text("""
        SELECT 1 FROM orphan_onus
        WHERE UPPER(mac_address) = :mac
          AND olt_host = :olt
          AND last_seen_at > NOW() - INTERVAL '1 hour'
        LIMIT 1
    """), {"mac": mac.upper(), "olt": olt}).fetchone()
    return row is not None


def _jsonable(d):
    import json
    return json.dumps(d, default=str)
