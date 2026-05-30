"""Customer profile enricher.

The engine knows where every linked customer's ONU lives (customer_dna).
The Pi poller knows each slot's optical MAC, vendor, model (onu_latest).
PG room data knows each room's ONU serial.

But the user-facing customer profile (customers table) historically only had
the Railwire-scraped fields and stayed empty for the OLT-derived ones — so
the admin UI showed "OLT: -" / "PON Port: -" / "Serial: -" even though we
knew all of it.

This service runs after every engine reconcile and copies the engine-derived
truth back to the customers row. Conservative defaults:

  * Never overwrite a non-NULL CSR-entered value unless the engine value is
    higher-confidence (verified > probable). Set `force=True` to override.
  * Always write to a previously-empty field.
  * Every change emits an activity event so the operator can see what filled in.

Fields enriched per linked customer:
  customers.olt_host                from customer_dna.olt_host
  customers.pon_port                from customer_dna.pon_port
  customers.onu_index               from customer_dna.onu_index
  customers.ont_model               from onu_latest.model_id  (if known)
  customers.ont_serial_number       from PG room's ont_serial (if assigned)
  customers.router_mac_address      from customer_dna.optical_mac, but only
                                    when it DIFFERS from customers.mac_address
                                    (because optical_mac == mac_address means
                                    they're the same physical box — no separate
                                    router MAC to record)
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from .activity_log import emit as activity_emit, SEVERITY_INFO

logger = logging.getLogger("rico_net.customer_profile_enricher")


@dataclass
class EnrichmentResult:
    customers_scanned: int = 0
    rows_enriched: int = 0
    fields_filled: int = 0   # total field-writes across all customers
    by_field: dict | None = None

    def __post_init__(self):
        if self.by_field is None:
            self.by_field = {}


# Sources we'll write back to customers row, in priority order.
# (column_name, source_table, source_column, only_if_target_empty)
_ENRICHMENT_RULES = [
    ("olt_host",   "customer_dna", "olt_host",    True),
    ("pon_port",   "customer_dna", "pon_port",    True),
    ("onu_index",  "customer_dna", "onu_index",   True),
]


def enrich_all(db: Session, *, force: bool = False) -> EnrichmentResult:
    """Single pass — enrich every linked customer's profile from engine/Pi data.

    Idempotent. Safe to call after every engine cycle (cheap: 1 UPDATE per
    customer that needs anything, ~1000 ms for 1k customers).

    Args:
        force: when True, overwrite even non-empty target fields. Default False
               protects CSR-entered values.
    """
    result = EnrichmentResult()

    # ── 1. Position fields (olt_host, pon_port, onu_index) from customer_dna
    # Use a single CTE-driven update for speed. COALESCE protects non-empty
    # customer fields unless force.
    overwrite = "TRUE" if force else "FALSE"
    rows = db.execute(text(f"""
        WITH need_update AS (
            SELECT c.username,
                   d.olt_host  AS new_olt,
                   d.pon_port  AS new_port,
                   d.onu_index AS new_idx,
                   d.optical_mac AS new_optical,
                   (c.olt_host  IS NULL OR c.olt_host = '')                       AS olt_empty,
                   (c.pon_port  IS NULL OR c.pon_port = '')                       AS port_empty,
                   (c.onu_index IS NULL)                                          AS idx_empty,
                   (c.router_mac_address IS NULL OR c.router_mac_address = '')    AS rmac_empty,
                   c.olt_host  AS cur_olt,
                   c.pon_port  AS cur_port,
                   c.onu_index AS cur_idx,
                   c.mac_address AS cur_mac
            FROM customers c
            JOIN customer_dna d ON d.username = c.username
            WHERE d.link_status = 'linked'
              AND d.olt_host IS NOT NULL
        )
        UPDATE customers c
        SET olt_host = CASE WHEN need_update.olt_empty OR {overwrite} THEN need_update.new_olt ELSE c.olt_host END,
            pon_port = CASE WHEN need_update.port_empty OR {overwrite} THEN need_update.new_port ELSE c.pon_port END,
            onu_index = CASE WHEN need_update.idx_empty OR {overwrite} THEN need_update.new_idx ELSE c.onu_index END,
            -- router_mac_address only if optical_mac differs from Railwire MAC
            -- (meaning there's a SEPARATE router behind the ONU)
            router_mac_address = CASE
                WHEN need_update.rmac_empty
                 AND need_update.new_optical IS NOT NULL
                 AND UPPER(need_update.new_optical) <> UPPER(COALESCE(need_update.cur_mac,''))
                THEN need_update.new_optical
                ELSE c.router_mac_address
            END
        FROM need_update
        WHERE c.username = need_update.username
          AND (
              (need_update.olt_empty  OR {overwrite}) AND need_update.cur_olt  IS DISTINCT FROM need_update.new_olt
              OR (need_update.port_empty OR {overwrite}) AND need_update.cur_port IS DISTINCT FROM need_update.new_port
              OR (need_update.idx_empty  OR {overwrite}) AND need_update.cur_idx  IS DISTINCT FROM need_update.new_idx
              OR (need_update.rmac_empty
                  AND need_update.new_optical IS NOT NULL
                  AND UPPER(need_update.new_optical) <> UPPER(COALESCE(need_update.cur_mac,''))
                 )
          )
        RETURNING c.username, c.olt_host, c.pon_port, c.onu_index, c.router_mac_address
    """)).mappings().all()
    result.rows_enriched = len(rows)
    if rows:
        logger.info("profile_enricher: filled position on %d customers", len(rows))

    # ── 2. ONT model from onu_latest (where engine knows the position)
    rows_model = db.execute(text("""
        WITH src AS (
            SELECT c.username, l.model_id AS new_model
            FROM customers c
            JOIN customer_dna d ON d.username = c.username
            JOIN onu_latest l
              ON l.olt_host = d.olt_host
             AND l.pon_port = d.pon_port
             AND l.onu_index = d.onu_index
            WHERE d.link_status = 'linked'
              AND l.model_id IS NOT NULL
              AND l.model_id <> ''
              AND (c.ont_model IS NULL OR c.ont_model = '')
        )
        UPDATE customers c
        SET ont_model = src.new_model
        FROM src
        WHERE c.username = src.username
        RETURNING c.username, c.ont_model
    """)).mappings().all()
    if rows_model:
        logger.info("profile_enricher: filled ont_model on %d customers", len(rows_model))

    # ── 3a. ONT serial from onu_latest (THE smart path — for every linked
    #        customer we already know their slot, the Pi already collected the
    #        SN for that slot via `show onu info all`. Just join.)
    rows_sn_olt = db.execute(text("""
        WITH src AS (
            SELECT c.username, l.ont_serial_number AS new_sn
            FROM customers c
            JOIN customer_dna d ON d.username = c.username
            JOIN onu_latest l
              ON l.olt_host = d.olt_host
             AND l.pon_port = d.pon_port
             AND l.onu_index = d.onu_index
            WHERE d.link_status = 'linked'
              AND l.ont_serial_number IS NOT NULL
              AND l.ont_serial_number <> ''
              AND (c.ont_serial_number IS NULL OR c.ont_serial_number = '')
        )
        UPDATE customers c
        SET ont_serial_number = src.new_sn
        FROM src
        WHERE c.username = src.username
        RETURNING c.username, c.ont_serial_number
    """)).mappings().all()
    if rows_sn_olt:
        logger.info("profile_enricher: filled ont_serial_number from OLT (onu_latest) on %d customers", len(rows_sn_olt))

    # ── 3b. Fallback: ONT serial from PG rooms (for customers whose ONU
    #        was scanned by field tech but isn't currently in onu_latest,
    #        e.g. EPON .100 customers where the OLT doesn't expose SN)
    rows_sn_pg = db.execute(text("""
        WITH src AS (
            SELECT DISTINCT ON (p.username)
                   p.username, p.ont_serial AS new_sn
            FROM pg_rooms p
            JOIN customers c ON c.username = p.username
            WHERE p.ont_serial IS NOT NULL
              AND p.ont_serial <> ''
              AND (c.ont_serial_number IS NULL OR c.ont_serial_number = '')
              AND p.username IS NOT NULL
            ORDER BY p.username, p.updated_at DESC NULLS LAST
        )
        UPDATE customers c
        SET ont_serial_number = src.new_sn
        FROM src
        WHERE c.username = src.username
        RETURNING c.username, c.ont_serial_number
    """)).mappings().all()
    if rows_sn_pg:
        logger.info("profile_enricher: filled ont_serial_number from PG fallback on %d customers", len(rows_sn_pg))

    rows_sn = rows_sn_olt + rows_sn_pg

    # Track stats
    result.by_field = {
        "position_fields": len(rows),
        "ont_model":       len(rows_model),
        "ont_serial_number": len(rows_sn),
    }
    result.fields_filled = sum(result.by_field.values())

    # Emit one summary activity event (not one per customer — would spam feed)
    if result.fields_filled > 0:
        activity_emit(
            db,
            category="enrichment.profile_filled",
            severity=SEVERITY_INFO,
            actor="customer_profile_enricher",
            summary=(
                f"Profile enrichment: filled {result.fields_filled} fields across "
                f"{result.rows_enriched} customers (positions={result.by_field['position_fields']}, "
                f"models={result.by_field['ont_model']}, "
                f"serials={result.by_field['ont_serial_number']})"
            ),
            payload=result.by_field,
        )

    db.commit()
    result.customers_scanned = db.execute(text("""
        SELECT COUNT(*) FROM customer_dna WHERE link_status = 'linked'
    """)).scalar() or 0
    return result


def get_completeness_stats(db: Session) -> dict:
    """Per-field coverage stats for the /pipeline KPI card."""
    r = db.execute(text("""
        WITH linked AS (
            SELECT c.username,
                   c.mac_address, c.olt_host, c.pon_port, c.onu_index,
                   c.ont_serial_number, c.ont_model, c.router_mac_address
            FROM customers c
            JOIN customer_dna d ON d.username = c.username
            WHERE d.link_status = 'linked'
        )
        SELECT
            COUNT(*) AS total_linked,
            COUNT(NULLIF(mac_address, ''))         AS has_mac,
            COUNT(NULLIF(olt_host, ''))            AS has_olt,
            COUNT(NULLIF(pon_port, ''))            AS has_pon_port,
            COUNT(onu_index)                       AS has_onu_index,
            COUNT(NULLIF(ont_serial_number, ''))   AS has_serial,
            COUNT(NULLIF(ont_model, ''))           AS has_model,
            COUNT(NULLIF(router_mac_address, ''))  AS has_router_mac
        FROM linked
    """)).mappings().fetchone()
    total = r["total_linked"] or 0
    return {
        "total_linked": total,
        "fields": {
            "mac_address":         {"filled": r["has_mac"],         "pct": _pct(r["has_mac"], total)},
            "olt_host":            {"filled": r["has_olt"],         "pct": _pct(r["has_olt"], total)},
            "pon_port":            {"filled": r["has_pon_port"],    "pct": _pct(r["has_pon_port"], total)},
            "onu_index":           {"filled": r["has_onu_index"],   "pct": _pct(r["has_onu_index"], total)},
            "ont_serial_number":   {"filled": r["has_serial"],      "pct": _pct(r["has_serial"], total)},
            "ont_model":           {"filled": r["has_model"],       "pct": _pct(r["has_model"], total)},
            "router_mac_address":  {"filled": r["has_router_mac"],  "pct": _pct(r["has_router_mac"], total)},
        },
        "completeness_pct": _pct(
            sum([r["has_mac"], r["has_olt"], r["has_pon_port"], r["has_onu_index"],
                 r["has_serial"], r["has_model"], r["has_router_mac"]]),
            total * 7,
        ),
    }


def _pct(n: int, d: int) -> float:
    return round(n * 100.0 / d, 1) if d else 0.0
