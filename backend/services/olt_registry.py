"""OLT Registry service — single source of truth for "which OLTs do we talk to."

Reads `olt_registry` table and surfaces one OltConfig per enabled row.
The OLT Engine adapters, SNMP runner, and admin UI all go through this.

Adding OLT #4 is `INSERT INTO olt_registry (...)` — no code change needed
as long as the new OLT matches an existing optical_adapter_profile.
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Dict, List, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session


@dataclass(frozen=True)
class OltConfig:
    host: str
    name: str
    vendor: Optional[str]
    model: Optional[str]
    firmware: Optional[str]
    pon_tech: str  # epon | gpon
    optical_adapter_profile: str

    # PON MAC table walk
    pon_mac_table_oid: Optional[str]
    pon_mac_position_col: Optional[int]
    pon_mac_col: Optional[int]
    pon_mac_indexed_by_oid: bool

    # SNMP transport
    snmp_community: str
    snmp_port: int
    snmp_timeout_sec: int
    snmp_chunk: int
    walk_timeout_sec: int
    empty_retry: bool

    # Capability flags
    has_lan_mac_table: bool
    lan_mac_oid: Optional[str]
    requires_survey_for_binding: bool
    has_customer_bandwidth: bool
    has_pon_bandwidth: bool
    has_offline_reason: bool
    has_traps_verified: bool
    customer_bandwidth_reason: Optional[str]
    binding_match_note: Optional[str]

    enabled: bool
    notes: Optional[str]

    # Per-OLT freshness SLO (seconds) for SNMP snapshots — see migration 027.
    snmp_slo_warn_sec: int = 300
    snmp_slo_critical_sec: int = 900


# Short-lived cache so each reconcile cycle doesn't hit DB N times.
_CACHE_TTL_SEC = 30
_cache_lock = threading.Lock()
_cache: Dict[str, OltConfig] = {}
_cache_loaded_at: float = 0.0


_SELECT_COLS = """
    host, name, vendor, model, firmware, pon_tech, optical_adapter_profile,
    pon_mac_table_oid, pon_mac_position_col, pon_mac_col, pon_mac_indexed_by_oid,
    snmp_community, snmp_port, snmp_timeout_sec, snmp_chunk, walk_timeout_sec, empty_retry,
    has_lan_mac_table, lan_mac_oid, requires_survey_for_binding,
    has_customer_bandwidth, has_pon_bandwidth, has_offline_reason, has_traps_verified,
    customer_bandwidth_reason, binding_match_note, enabled, notes,
    snmp_slo_warn_sec, snmp_slo_critical_sec
"""


def _row_to_cfg(r) -> OltConfig:
    return OltConfig(
        host=r["host"],
        name=r["name"],
        vendor=r["vendor"],
        model=r["model"],
        firmware=r["firmware"],
        pon_tech=r["pon_tech"],
        optical_adapter_profile=r["optical_adapter_profile"],
        pon_mac_table_oid=r["pon_mac_table_oid"],
        pon_mac_position_col=r["pon_mac_position_col"],
        pon_mac_col=r["pon_mac_col"],
        pon_mac_indexed_by_oid=bool(r["pon_mac_indexed_by_oid"]),
        snmp_community=r["snmp_community"],
        snmp_port=r["snmp_port"],
        snmp_timeout_sec=r["snmp_timeout_sec"],
        snmp_chunk=r["snmp_chunk"],
        walk_timeout_sec=r["walk_timeout_sec"],
        empty_retry=bool(r["empty_retry"]),
        has_lan_mac_table=bool(r["has_lan_mac_table"]),
        lan_mac_oid=r["lan_mac_oid"],
        requires_survey_for_binding=bool(r["requires_survey_for_binding"]),
        has_customer_bandwidth=bool(r["has_customer_bandwidth"]),
        has_pon_bandwidth=bool(r["has_pon_bandwidth"]),
        has_offline_reason=bool(r["has_offline_reason"]),
        has_traps_verified=bool(r["has_traps_verified"]),
        customer_bandwidth_reason=r["customer_bandwidth_reason"],
        binding_match_note=r["binding_match_note"],
        enabled=bool(r["enabled"]),
        notes=r["notes"],
        snmp_slo_warn_sec=int(r["snmp_slo_warn_sec"] or 300),
        snmp_slo_critical_sec=int(r["snmp_slo_critical_sec"] or 900),
    )


def _refresh(db: Session):
    global _cache, _cache_loaded_at
    rows = db.execute(text(f"SELECT {_SELECT_COLS} FROM olt_registry ORDER BY host")).mappings().all()
    _cache = {r["host"]: _row_to_cfg(r) for r in rows}
    _cache_loaded_at = time.time()


def _ensure_loaded(db: Session, force: bool = False):
    with _cache_lock:
        if force or (time.time() - _cache_loaded_at) > _CACHE_TTL_SEC or not _cache:
            _refresh(db)


def invalidate_cache():
    """Call after INSERT/UPDATE/DELETE on olt_registry so next read is fresh."""
    global _cache_loaded_at
    with _cache_lock:
        _cache_loaded_at = 0.0


def list_all(db: Session) -> List[OltConfig]:
    """Every row in the registry — enabled or not. Used by admin UI."""
    _ensure_loaded(db)
    return list(_cache.values())


def list_active(db: Session) -> List[OltConfig]:
    """Only enabled OLTs. Used by the engine + Pi poller config endpoint."""
    _ensure_loaded(db)
    return [c for c in _cache.values() if c.enabled]


def active_hosts(db: Session) -> List[str]:
    """Convenience: just the host strings of enabled OLTs (sorted)."""
    return sorted(c.host for c in list_active(db))


def get(db: Session, host: str) -> Optional[OltConfig]:
    """Look up one OLT by host. Returns None if unknown."""
    _ensure_loaded(db)
    return _cache.get(host)


def peek(host: str) -> Optional[OltConfig]:
    """Cache-only lookup — no DB. Callers in the SNMP hot path (snmp_runner,
    pon_mac_adapter) use this; the engine façade primes the cache once per cycle
    with list_active(db) so peek() finds fresh data."""
    return _cache.get(host)


def peek_all_hosts() -> List[str]:
    """Cache-only enabled host list. Returns empty list if cache cold."""
    return sorted(c.host for c in _cache.values() if c.enabled)
