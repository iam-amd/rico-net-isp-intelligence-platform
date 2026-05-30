"""
Binding reconciler — fills `onu_bindings.(olt_host, pon_port, onu_index)` from
the live data the OLT poller has ALREADY put into `onu_latest`.

Rationale: Netlink combined ONU+router hardware uses the same MAC pool for the
ONU optical interface and the Railwire-side WAN interface. For ~83% of active
customers (931/1128 as of 2026-05-20), `customers.mac_address` directly matches
a row in `onu_latest`. That row already carries the correct ONU position. We
just have to copy it into the binding.

What it does:
  1. Pull every active binding row whose `customer_id` is an Active customer
     with a non-null `mac_address`.
  2. Join against `onu_latest` on UPPER(mac).
  3. For each match:
       - If binding has no position OR position differs from the match:
           - If binding is NOT 'verified':  UPDATE position; bump confidence
             to 'probable' if it was 'guess'.
           - If binding IS 'verified' AND position conflicts: skip and report
             (verified rows are protected; manual review needed).
  4. Returns a structured ReconcileResult.

Read-only by default. Pass `apply=True` to commit changes.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session


@dataclass
class ReconcileChange:
    binding_id: int
    customer_id: str
    railwire_mac: str
    from_position: Optional[str]   # "olt/port/idx" or None
    to_position: str
    action: str                    # 'fill' | 'update' | 'skip_verified_conflict'
    binding_source: str
    confidence: str


@dataclass
class ReconcileResult:
    verified_identity_matches: int = 0
    direct_matches: int = 0                # rows where Railwire MAC ↔ onu_latest
    already_correct: int = 0               # binding position already matches
    position_filled: int = 0               # binding had no position, now filled
    position_updated: int = 0              # binding had stale position, refreshed
    verified_conflicts: int = 0            # verified row disagrees — left alone
    confidence_upgrades: int = 0           # guess → probable when position fills
    changes: List[ReconcileChange] = field(default_factory=list)
    applied: bool = False


# ------------------------------------------------------------------
# Core query
# ------------------------------------------------------------------

# Aggregation-slot filter: a slot (olt+port+index) that holds many MACs is
# an uplink/bridging interface, not a customer slot. Bind nothing through it.
# Threshold 5 matches pon_mac_adapter.PonMacAdapter.AGGREGATION_SLOT_THRESHOLD.
# Without this filter, customers whose Railwire MAC is the router LAN MAC get
# bound to the uplink slot (e.g. .200 0/1/4 with 90+ MACs) instead of their
# real ONU slot — causing position_changed flap every cycle.
_RECONCILE_QUERY = text("""
    WITH agg_slots AS (
        SELECT olt_host, pon_port, onu_index
        FROM onu_latest
        WHERE polled_at > NOW() - INTERVAL '1 hour'
        GROUP BY olt_host, pon_port, onu_index
        HAVING COUNT(DISTINCT mac_address) > 5
    ),
    direct_match AS (
        SELECT
            c.username                                        AS customer_id,
            UPPER(c.mac_address)                              AS railwire_mac,
            ol.olt_host                                       AS new_olt,
            ol.pon_port                                       AS new_port,
            ol.onu_index                                      AS new_idx
        FROM customers c
        JOIN onu_latest ol ON UPPER(ol.mac_address) = UPPER(c.mac_address)
        WHERE c.status = 'Active'
          AND c.mac_address IS NOT NULL
          AND c.mac_address <> ''
          AND NOT EXISTS (
              SELECT 1 FROM agg_slots a
              WHERE a.olt_host  = ol.olt_host
                AND a.pon_port  = ol.pon_port
                AND a.onu_index = ol.onu_index
          )
    )
    SELECT
        b.id                AS binding_id,
        b.customer_id,
        b.binding_source,
        b.confidence,
        b.olt_host          AS cur_olt,
        b.pon_port          AS cur_port,
        b.onu_index         AS cur_idx,
        b.is_active,
        dm.railwire_mac,
        dm.new_olt,
        dm.new_port,
        dm.new_idx
    FROM direct_match dm
    JOIN onu_bindings b
      ON b.customer_id = dm.customer_id
     AND b.is_active   = TRUE
     AND COALESCE(LOWER(b.confidence), '') <> 'verified'
""")


_VERIFIED_IDENTITY_QUERY = text("""
    WITH verified_binding AS (
        SELECT
            b.id,
            b.customer_id,
            b.binding_source,
            b.confidence,
            b.olt_host AS cur_olt,
            b.pon_port AS cur_port,
            b.onu_index AS cur_idx,
            UPPER(b.onu_identifier) AS onu_identifier,
            UPPER(b.mac_address) AS mac_address,
            UPPER(b.serial_number) AS serial_number,
            CASE
                WHEN b.serial_number IS NOT NULL AND b.serial_number <> ''
                THEN 'SN:' || UPPER(b.serial_number)
                ELSE NULL
            END AS prefixed_serial_number
        FROM onu_bindings b
        WHERE b.is_active = TRUE
          AND COALESCE(LOWER(b.confidence), '') = 'verified'
    ),
    latest_match AS (
        SELECT DISTINCT ON (b.id)
            b.id AS binding_id,
            b.customer_id,
            b.binding_source,
            b.confidence,
            b.cur_olt,
            b.cur_port,
            b.cur_idx,
            ol.mac_address AS observed_identity,
            ol.olt_host AS new_olt,
            ol.pon_port AS new_port,
            ol.onu_index AS new_idx,
            ol.polled_at
        FROM verified_binding b
        JOIN onu_latest ol
          ON UPPER(ol.mac_address) IN (
              b.onu_identifier,
              b.mac_address,
              b.serial_number,
              b.prefixed_serial_number
          )
        WHERE ol.polled_at > NOW() - INTERVAL '10 minutes'
        ORDER BY b.id, ol.polled_at DESC
    )
    SELECT * FROM latest_match
""")


_UPDATE_BINDING = text("""
    UPDATE onu_bindings
       SET olt_host   = :new_olt,
           pon_port   = :new_port,
           onu_index  = :new_idx,
           confidence = :new_confidence,
           last_seen  = :now
     WHERE id = :binding_id
       AND is_active = TRUE
""")


def reconcile_bindings_from_onu_latest(db: Session, *, apply: bool = False) -> ReconcileResult:
    """
    Keep binding positions synced to live OLT rows.
    Verified bindings follow their own ONT identity. Railwire MAC is only used
    as weaker evidence for non-verified bindings.

    """
    result = ReconcileResult(applied=apply)
    now = datetime.now(timezone.utc)

    verified_rows = db.execute(_VERIFIED_IDENTITY_QUERY).mappings().all()
    result.verified_identity_matches = len(verified_rows)
    for row in verified_rows:
        same_position = (
            row["cur_olt"] == row["new_olt"] and
            row["cur_port"] == row["new_port"] and
            row["cur_idx"] == row["new_idx"]
        )
        if same_position:
            result.already_correct += 1
            continue

        has_position = bool(row["cur_olt"] and row["cur_port"] and row["cur_idx"] is not None)
        action = "fill" if not has_position else "update"
        if action == "fill":
            result.position_filled += 1
        else:
            result.position_updated += 1

        result.changes.append(ReconcileChange(
            binding_id=row["binding_id"],
            customer_id=row["customer_id"],
            railwire_mac=row["observed_identity"],
            from_position=f"{row['cur_olt']}/{row['cur_port']}/{row['cur_idx']}" if has_position else None,
            to_position=f"{row['new_olt']}/{row['new_port']}/{row['new_idx']}",
            action=action,
            binding_source=row["binding_source"],
            confidence=row["confidence"],
        ))

        if apply:
            db.execute(_UPDATE_BINDING, {
                "binding_id": row["binding_id"],
                "new_olt": row["new_olt"],
                "new_port": row["new_port"],
                "new_idx": row["new_idx"],
                "new_confidence": row["confidence"],
                "now": now,
            })

    rows = db.execute(_RECONCILE_QUERY).mappings().all()
    result.direct_matches = len(rows)

    for row in rows:
        same_position = (
            row["cur_olt"]  == row["new_olt"] and
            row["cur_port"] == row["new_port"] and
            row["cur_idx"]  == row["new_idx"]
        )
        if same_position:
            result.already_correct += 1
            continue

        has_position = bool(row["cur_olt"] and row["cur_port"] and row["cur_idx"] is not None)
        is_verified  = (row["confidence"] or "").lower() == "verified"

        # Protect verified rows that disagree — they need human review.
        if is_verified and has_position:
            result.verified_conflicts += 1
            result.changes.append(ReconcileChange(
                binding_id      = row["binding_id"],
                customer_id     = row["customer_id"],
                railwire_mac    = row["railwire_mac"],
                from_position   = f"{row['cur_olt']}/{row['cur_port']}/{row['cur_idx']}",
                to_position     = f"{row['new_olt']}/{row['new_port']}/{row['new_idx']}",
                action          = "skip_verified_conflict",
                binding_source  = row["binding_source"],
                confidence      = row["confidence"],
            ))
            continue

        # Decide new confidence:
        # - 'guess'  → upgrade to 'probable' (direct OLT match is real evidence)
        # - others   → keep as-is
        new_conf = "probable" if (row["confidence"] or "").lower() == "guess" else row["confidence"]
        is_upgrade = (new_conf != row["confidence"])

        action = "fill" if not has_position else "update"
        if action == "fill":
            result.position_filled += 1
        else:
            result.position_updated += 1
        if is_upgrade:
            result.confidence_upgrades += 1

        result.changes.append(ReconcileChange(
            binding_id      = row["binding_id"],
            customer_id     = row["customer_id"],
            railwire_mac    = row["railwire_mac"],
            from_position   = f"{row['cur_olt']}/{row['cur_port']}/{row['cur_idx']}" if has_position else None,
            to_position     = f"{row['new_olt']}/{row['new_port']}/{row['new_idx']}",
            action          = action,
            binding_source  = row["binding_source"],
            confidence      = new_conf,
        ))

        if apply:
            db.execute(_UPDATE_BINDING, {
                "binding_id"     : row["binding_id"],
                "new_olt"        : row["new_olt"],
                "new_port"       : row["new_port"],
                "new_idx"        : row["new_idx"],
                "new_confidence" : new_conf,
                "now"            : now,
            })

    if apply:
        db.commit()

    return result


def summary_lines(result: ReconcileResult) -> List[str]:
    """Human-readable summary for logs / CLI."""
    return [
        f"applied              : {result.applied}",
        f"verified_identity_matches : {result.verified_identity_matches}",
        f"direct_matches       : {result.direct_matches}",
        f"already_correct      : {result.already_correct}",
        f"position_filled      : {result.position_filled}",
        f"position_updated     : {result.position_updated}",
        f"confidence_upgrades  : {result.confidence_upgrades}",
        f"verified_conflicts   : {result.verified_conflicts}  (need manual review)",
    ]
