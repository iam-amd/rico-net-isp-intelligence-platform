"""
Rico Net — NOC Service
=======================
Query logic for the NOC Dashboard. Reads from onu_latest, onu_snapshots,
alarm_events, and customers tables. No FastAPI imports.
"""
import csv
import hashlib
import ipaddress
import json
import logging
import os
import platform
import re
import subprocess
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

from sqlalchemy import func, case, text, or_
from sqlalchemy.orm import Session

import models
from config.olt_capabilities import OLT_CAPABILITIES, get_olt_capability, serialize_olt_capability
from config.settings import settings
from services.onu_binding_service import (
    build_binding_identity,
    find_active_binding_for_observed_onu,
    find_customer_for_observed_onu,
    normalize_mac,
    observed_lookup_values,
)

logger = logging.getLogger("rico_net.noc_service")

OLT_FRESH_WARN_SECONDS = 600
OLT_FRESH_CRITICAL_SECONDS = 1800
# Collectors poll OLTs in multi-minute cycles. Allow one full slow cycle plus
# jitter before treating a host as missing from the latest whole-network view.
OLT_CYCLE_ALIGNMENT_SECONDS = 360


def _bandwidth_unavailable(reason: str, *, source_status: str = "unsupported") -> Dict[str, Any]:
    return {
        "rx_mbps": None,
        "tx_mbps": None,
        "sampled_at": None,
        "supported": False,
        "source_status": source_status,
        "reason": reason,
    }

# Approximate PON port cluster coordinates (SRM Potheri / Kattankulathur area)
# Used as fallback when a customer has no geo coordinates
_PORT_CLUSTER_COORDS: Dict[str, Tuple[float, float]] = {
    '0/1': (12.832, 80.032),
    '0/2': (12.830, 80.044),
    '0/3': (12.825, 80.053),
    '0/4': (12.816, 80.052),
    '0/5': (12.810, 80.043),
    '0/6': (12.811, 80.033),
    '0/7': (12.817, 80.025),
    '0/8': (12.824, 80.026),
}

# Approximate coordinates for known Potheri/Kattankulathur localities.
# Derived from the top area names in railwire_address data.
# Reference point: SRM University at (12.823, 80.044).
# Accuracy: ±300m (street level within the service area — NOT GPS).
# Improvement path: field tech GPS via mobile app → stored in customers.geo_lat/geo_long
#                   WhatsApp live location → admin records in customer profile
_AREA_COORDS: Dict[str, Tuple[float, float]] = {
    # --- Near SRM University (north-east cluster) ---
    'VICTORIA AVENUE':          (12.825, 80.044),
    'VICTORIA APPARTMENT':      (12.825, 80.044),
    'VICKTORIA AVENUE':         (12.825, 80.044),
    'VILLA SHAKUNTHA':          (12.826, 80.047),
    'SAI NIVAS':                (12.824, 80.043),
    'NEAR TRS HOSTEL':          (12.827, 80.042),
    'TRS BACK SIDE':            (12.826, 80.041),
    'TRS HOSTEL BACK SIDE':     (12.826, 80.041),
    'MUTHU TOWERS OPP':         (12.822, 80.044),
    # --- GST Road corridor (central north-south spine) ---
    'G S T ROAD':               (12.820, 80.044),
    'GST ROAD':                 (12.820, 80.044),
    'ALI NAGAR':                (12.820, 80.042),
    # --- Old Potheri village (west/south-west cluster) ---
    'NARASIMAN NAGAR':          (12.820, 80.037),
    'AADHIPARASAKTHI NAGAR':    (12.818, 80.035),
    'SAMUNDESWARI NAGAR':       (12.818, 80.039),
    'VIJAYALAKSHMI NAGAR':      (12.821, 80.037),
    'KAMBER STREET':            (12.816, 80.038),
    'MOOPANAR STREET':          (12.817, 80.038),
    'MOOPANAR ST':              (12.817, 80.038),
    'PILLIYAR KOVIL STREET':    (12.815, 80.037),
    'PILLIYAR KOVIL ST':        (12.815, 80.037),
    'ANNA STREET':              (12.818, 80.038),
    'BAJANAI KOVIL STREET':     (12.815, 80.039),
    'AMBEDKAR STREET':          (12.816, 80.040),
    'DR.AMBEDKAR STREET':       (12.816, 80.040),
    'BHARATHIYAR STREET':       (12.818, 80.039),
    'PERUMAL KOVIL STREET':     (12.814, 80.039),
    'GURUSAMY STREET':          (12.817, 80.037),
    # --- Spelling variants ---
    'AATHIPARASAKTHI NAGAR':    (12.818, 80.035),
    'AATHIPARASAKTHI STREET':   (12.818, 80.036),
    'SAMUNDEESWARI NAGAR':      (12.818, 80.039),
    'BAJANAI KOVIL ST':         (12.815, 80.039),
    'KAMBER ST':                (12.816, 80.038),
    'VIJAYALAKSHMI APP':        (12.821, 80.037),
    # --- Additional streets & landmarks (5+ customers) ---
    'DRAVIDAN STREET':          (12.816, 80.037),
    'KAMARAJAR STREET':         (12.817, 80.036),
    'BHUVANESWARI AMMAN NAGAR': (12.819, 80.036),
    'MUTHU TOWERS':             (12.822, 80.044),
    'TAMILNADU HOUSING BOARD':  (12.822, 80.041),
    'HELLANA PALACE':           (12.823, 80.043),
    'DURGA ILLAM':              (12.823, 80.045),
    'TOWER BUILDING':           (12.821, 80.043),
    'VARSHA AVENUE':            (12.824, 80.046),
    'GOKULAM HOMES':            (12.823, 80.042),
    'IFFAH GUEST HOUSE':        (12.824, 80.044),
    'NEW MEDICAL STAFF QUARTERS': (12.826, 80.046),
    'SRM MAIN CAMPUS':          (12.823, 80.044),
    # --- Nearby villages (full address match — 6+ customers each) ---
    'THAILAVARAM':              (12.805, 80.040),
    'KORUGANTHANGAL':           (12.798, 80.032),
    'KONATHI':                  (12.792, 80.044),
    'KATTANKULATHUR':           (12.810, 80.050),
    'KATTUPAKKAM':              (12.833, 80.035),
    'KAYARAMBEDU':              (12.788, 80.050),
    'VALLANCHERY':              (12.812, 80.028),
    'THIRUTHAVELLI':            (12.795, 80.038),
    'POTHERI':                  (12.822, 80.042),
}

# Jitter radius for area-level coordinates: ~80m (0.0008 deg).
# Small enough that same-area customers cluster together visually.
_AREA_JITTER_RADIUS = 0.0008


def _extract_area_coords(address: str) -> Optional[Tuple[float, float]]:
    """
    Parse a Railwire address string and return approximate (lat, lng) based
    on the known locality/street name.  Returns None if no match found.

    Scans comma-separated parts 1–3 (skipping house number at part 0) for
    any key from _AREA_COORDS.  Longest matching key wins so "PILLIYAR KOVIL
    STREET" beats "STREET" if both were in the dict.
    """
    if not address:
        return None
    parts = [p.strip().upper() for p in address.split(',')]
    # Check parts 1 onward (part 0 is usually house number)
    for part in parts[1:4]:
        best_key = None
        best_len = 0
        for key in _AREA_COORDS:
            if key in part and len(key) > best_len:
                best_key = key
                best_len = len(key)
        if best_key:
            return _AREA_COORDS[best_key]
    return None


def _cluster_jitter(mac: str, radius_deg: float = 0.006) -> Tuple[float, float]:
    """
    Deterministic positional jitter for a given MAC.
    Spreads ONUs ~600m radius around their PON port cluster center.
    Uses MD5 of MAC as a stable pseudo-random seed so positions
    don't change on reload.
    """
    h = int(hashlib.md5(mac.encode()).hexdigest(), 16)
    lat_off = ((h & 0xFFFF) / 0xFFFF - 0.5) * 2 * radius_deg
    lng_off = (((h >> 16) & 0xFFFF) / 0xFFFF - 0.5) * 2 * radius_deg
    return lat_off, lng_off


def _load_customer_index(db: Session) -> Dict:
    """
    Load all customers with MAC addresses into a prefix-indexed structure.
    Returns dict: { mac_prefix_14_chars -> [(last_byte_int, customer_row, full_upper_mac)] }
    Netlink ONUs use the same first 5 octets for ONU MAC and PPPoE MAC, differing
    only in the last octet (typically +1 to +5 offset).
    """
    customers = db.query(
        models.Customer.id,
        models.Customer.username,
        models.Customer.mac_address,
        models.Customer.first_name,
        models.Customer.last_name,
        models.Customer.phone,
        models.Customer.plan_name,
        models.Customer.expiry_date,
        models.Customer.railwire_address,
        models.Customer.gps_lat,
        models.Customer.gps_lng,
        models.Customer.geo_lat,
        models.Customer.geo_long,
        models.Customer.status,
        models.Customer.balance,
    ).filter(models.Customer.mac_address.isnot(None)).all()

    index: Dict[str, List] = {}
    for c in customers:
        if not c.mac_address:
            continue
        upper = c.mac_address.upper()
        try:
            last_byte = int(upper[-2:], 16)
        except ValueError:
            continue
        prefix = upper[:14]  # "14:A7:2B:EC:D9"
        if prefix not in index:
            index[prefix] = []
        index[prefix].append((last_byte, c, upper))
    return index


# Confirmed MAC offsets per OUI (ONU EPON MAC + offset = Railwire PPPoE/WAN MAC).
# Based on Netlink ONT firmware: EPON port = base MAC, WAN port = base + N.
# Verified 2026-04-04: Brute-force analysis of all 256 offsets per OUI confirmed:
#   +9 dominant, +5 secondary, +1 for older 8C:C7:C3 batch (ports 0/6, 0/7).
#   8C:13:E2 "new" offsets (249,137,etc) are coincidental prefix collisions, not real.
_OUI_OFFSETS: Dict[str, List[int]] = {
    '8C:C7:C3': [9, 5, 1],  # Netlink ONT family A — +9 (55), +5 (18), +1 (7 older batch)
    '8C:13:E2': [9, 5],     # Netlink ONT family B — +9 (23), +5 (11)
    '14:A7:2B': [9, 5],     # Netlink ONT family C — +9 (6), +5 (2)
    'B8:B7:DB': [9],         # Non-Netlink but +9 offset confirmed (3 matches)
    'D0:1E:1D': [9],         # Non-Netlink but +9 offset confirmed (1 match)
    '80:14:A8': [5],         # Non-Netlink, +5 confirmed (1 match)
}
# For unrecognised OUIs try +9, +5, +1 (covers all known ONT firmware patterns)
_DEFAULT_OFFSETS: List[int] = [9, 5, 1]


def _fuzzy_find_customer(index: Dict, onu_mac: str) -> Optional[Any]:
    """
    Find the customer whose Railwire PPPoE MAC matches this ONU's EPON MAC.

    Strategy (in priority order):
    1. Exact MAC match (same device, unlikely but handle it)
    2. Per-OUI exact offset match (ONU + known_offset == customer MAC last byte)

    Uses ONLY exact offsets — never a fuzzy range — to avoid false positives
    where a neighbouring device on the same PON port could match.
    """
    upper = onu_mac.upper()
    prefix = upper[:14]
    try:
        onu_last = int(upper[-2:], 16)
    except ValueError:
        return None

    candidates = index.get(prefix, [])
    if not candidates:
        return None

    # 1. Exact match
    for (cust_last, c, cust_upper) in candidates:
        if cust_upper == upper:
            return c

    # Production rule: exact MAC only. If SNMP does not expose the exact
    # Railwire/customer MAC, leave it unlinked for survey/admin review.
    return None

    # 2. Exact offset match using known per-OUI offsets
    oui = upper[:8]  # e.g. "8C:C7:C3"
    offsets = _OUI_OFFSETS.get(oui, _DEFAULT_OFFSETS)
    for offset in offsets:
        expected = (onu_last + offset) & 0xFF
        for (cust_last, c, _) in candidates:
            if cust_last == expected:
                return c

    return None


def _binding_matches_observed_identity(binding: models.ONUBinding, observed_identifier: str) -> bool:
    lookup = observed_lookup_values(observed_identifier)
    ids = lookup["identifiers"]
    if not ids:
        return False
    return any(
        str(value).strip().upper() in ids
        for value in (binding.onu_identifier, binding.serial_number, binding.mac_address)
        if value
    )


def _customer_name(c: Any) -> Optional[str]:
    if not c:
        return None
    parts = [
        (c.first_name or '').strip(),
        (c.last_name or '').strip(),
    ]
    name = ' '.join(p for p in parts if p and p.lower() != 'nan')
    return name or None


def _is_active_customer(c: Any) -> bool:
    status = (getattr(c, "status", None) or "").strip().lower()
    return status in {"active", "online", "enabled"}


def _is_expired_customer(c: Any, now: Optional[datetime] = None) -> bool:
    expiry = getattr(c, "expiry_date", None)
    if not expiry:
        return False
    now = now or datetime.now(timezone.utc)
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)
    return expiry < now


def _olt_freshness_state(db: Session, now: Optional[datetime] = None) -> Dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    latest_rows = db.query(
        models.ONULatest.olt_host,
        func.max(models.ONULatest.polled_at).label("last_poll"),
    ).filter(
        models.ONULatest.olt_host.isnot(None),
    ).group_by(
        models.ONULatest.olt_host,
    ).all()

    poll_by_host: Dict[str, Optional[datetime]] = {
        host: last_poll for host, last_poll in latest_rows if host
    }
    quality_rows = db.execute(text("""
        WITH latest AS (
            SELECT olt_host, MAX(polled_at) AS latest_poll
            FROM onu_latest
            WHERE olt_host IS NOT NULL
            GROUP BY olt_host
        ),
        current_batch AS (
            SELECT o.*
            FROM onu_latest o
            JOIN latest l ON l.olt_host = o.olt_host
            WHERE o.polled_at >= l.latest_poll - INTERVAL '30 seconds'
              AND o.pon_port IS NOT NULL
              AND btrim(o.pon_port) <> ''
              AND o.onu_index IS NOT NULL
        )
        SELECT
            olt_host,
            COUNT(mac_address) AS total,
            COUNT(*) FILTER (WHERE status = 'online') AS online,
            COUNT(*) FILTER (WHERE rx_power_dbm IS NOT NULL) AS optical
        FROM current_batch
        GROUP BY olt_host
    """)).fetchall()
    quality_by_host = {
        row.olt_host: {
            "total": int(row.total or 0),
            "online": int(row.online or 0),
            "optical": int(row.optical or 0),
        }
        for row in quality_rows
        if row.olt_host
    }

    expected_hosts = set(poll_by_host.keys())
    collector_groups: List[Set[str]] = []
    for collector in db.query(models.CollectorHealth).all():
        if (collector.last_status or "").lower() in {"retired", "disabled"}:
            continue
        group: Set[str] = set()
        for host in collector.configured_olts or []:
            if host:
                host_value = str(host)
                expected_hosts.add(host_value)
                group.add(host_value)
        if group:
            collector_groups.append(group)

    health_rows = db.query(models.OLTHealth).all()
    for health in health_rows:
        if health.olt_host:
            expected_hosts.add(health.olt_host)
            if health.last_snapshot_at:
                current = poll_by_host.get(health.olt_host)
                if not current or health.last_snapshot_at > current:
                    poll_by_host[health.olt_host] = health.last_snapshot_at

    hosts: List[str] = sorted(expected_hosts)
    stale_hosts: List[str] = []
    missing_hosts: List[str] = []
    untrusted_hosts: List[str] = []
    out_of_cycle_hosts: List[str] = []
    ages: Dict[str, Optional[float]] = {}
    newest_poll = None
    worst_age = 0.0

    for host in hosts:
        last_poll = poll_by_host.get(host)
        if last_poll and (newest_poll is None or last_poll > newest_poll):
            newest_poll = last_poll
        if not last_poll:
            missing_hosts.append(host)
            ages[host] = None
            worst_age = float("inf")
            continue
        last_poll_aware = last_poll.replace(tzinfo=timezone.utc) if last_poll.tzinfo is None else last_poll
        age = (now - last_poll_aware).total_seconds()
        ages[host] = age
        if age > OLT_FRESH_CRITICAL_SECONDS:
            stale_hosts.append(host)
        quality = quality_by_host.get(host, {})
        if (
            age <= OLT_FRESH_CRITICAL_SECONDS
            and quality.get("total", 0) >= 50
            and quality.get("optical", 0) == 0
        ):
            untrusted_hosts.append(host)
        if age > worst_age:
            worst_age = age

    grouped_hosts = {host for group in collector_groups for host in group}
    ungrouped_hosts = set(hosts) - grouped_hosts
    alignment_groups = collector_groups + ([ungrouped_hosts] if len(ungrouped_hosts) > 1 else [])
    for group in alignment_groups:
        group_polls = [poll_by_host.get(host) for host in group if poll_by_host.get(host)]
        if not group_polls:
            continue
        group_newest = max(group_polls)
        group_newest_aware = group_newest.replace(tzinfo=timezone.utc) if group_newest.tzinfo is None else group_newest
        for host in sorted(group):
            last_poll = poll_by_host.get(host)
            if not last_poll:
                continue
            last_poll_aware = last_poll.replace(tzinfo=timezone.utc) if last_poll.tzinfo is None else last_poll
            if (group_newest_aware - last_poll_aware).total_seconds() > OLT_CYCLE_ALIGNMENT_SECONDS:
                out_of_cycle_hosts.append(host)

    if not hosts:
        return {
            "hosts": [],
            "last_poll": None,
            "data_is_stale": True,
            "staleness_seconds": float("inf"),
            "source_status": "unavailable",
            "message": "No OLT poll has ever been received. NOC cannot make live network decisions.",
            "stale_hosts": [],
            "missing_hosts": [],
            "untrusted_hosts": [],
            "out_of_cycle_hosts": [],
            "ages": {},
            "quality": {},
        }

    data_is_stale = bool(stale_hosts or missing_hosts or untrusted_hosts or out_of_cycle_hosts)
    if data_is_stale:
        problem_hosts = (
            stale_hosts
            + [h for h in missing_hosts if h not in stale_hosts]
            + [h for h in untrusted_hosts if h not in stale_hosts and h not in missing_hosts]
            + [
                h for h in out_of_cycle_hosts
                if h not in stale_hosts and h not in missing_hosts and h not in untrusted_hosts
            ]
        )
        host_list = ", ".join(problem_hosts[:4])
        extra = f" ({host_list})" if host_list else ""
        if out_of_cycle_hosts:
            message = (
                f"OLT data is incomplete for {len(problem_hosts)}/{len(hosts)} OLTs{extra}. "
                "At least one expected OLT did not participate in the latest poll cycle, so live NOC KPIs are last-known."
            )
        elif untrusted_hosts:
            message = (
                f"OLT data is stale or failed quality checks for {len(problem_hosts)}/{len(hosts)} OLTs{extra}. "
                "A fresh poll with no optical RX values is treated as incomplete; do not use it as live optical state."
            )
        else:
            message = (
                f"OLT data is stale for {len(problem_hosts)}/{len(hosts)} OLTs{extra}. "
                "Counts and Rx are last-known only; do not use them as live state."
            )
    else:
        message = "OLT data is fresh."

    return {
        "hosts": hosts,
        "last_poll": newest_poll,
        "data_is_stale": data_is_stale,
        "staleness_seconds": worst_age,
        "source_status": "stale" if data_is_stale else "live",
        "message": message,
        "stale_hosts": stale_hosts,
        "missing_hosts": missing_hosts,
        "untrusted_hosts": untrusted_hosts,
        "out_of_cycle_hosts": out_of_cycle_hosts,
        "ages": ages,
        "quality": quality_by_host,
    }


def get_network_summary(db: Session) -> Dict[str, Any]:
    """KPI strip data: total ONUs, online/offline counts, avg Rx, alarm count (24h)."""
    result = db.execute(text("""
        WITH latest AS (
            SELECT olt_host, MAX(polled_at) AS latest_poll
            FROM onu_latest
            WHERE olt_host IS NOT NULL
            GROUP BY olt_host
        ),
        current_batch AS (
            SELECT o.*
            FROM onu_latest o
            JOIN latest l ON l.olt_host = o.olt_host
            WHERE o.polled_at >= l.latest_poll - INTERVAL '30 seconds'
              AND o.pon_port IS NOT NULL
              AND btrim(o.pon_port) <> ''
              AND o.onu_index IS NOT NULL
        )
        SELECT
            COUNT(mac_address) AS total,
            COUNT(*) FILTER (WHERE status = 'online') AS online,
            COUNT(*) FILTER (WHERE status <> 'online' OR status IS NULL) AS offline,
            AVG(rx_power_dbm) AS avg_rx,
            MIN(rx_power_dbm) AS worst_rx,
            MAX(polled_at) AS last_poll
        FROM current_batch
    """)).one()

    recent_offline = db.execute(text("""
        SELECT COUNT(DISTINCT mac_address)
        FROM onu_latest
        WHERE status <> 'online'
          AND polled_at >= NOW() - INTERVAL '24 hours'
          AND pon_port IS NOT NULL
          AND btrim(pon_port) <> ''
          AND onu_index IS NOT NULL
    """)).scalar() or 0

    # Distinct OLT hosts
    olt_hosts = [
        row[0] for row in
        db.query(models.ONULatest.olt_host).distinct().all()
        if row[0]
    ]

    # Actionable alarm load in the last 24h. Historical resolved rows can be
    # very noisy after collector recovery and should not drive the KPI strip.
    since_24h = datetime.now(timezone.utc) - timedelta(hours=24)
    alarm_count = db.query(func.count(models.AlarmEvent.id)).filter(
        models.AlarmEvent.received_at >= since_24h,
        models.AlarmEvent.status == "open",
    ).scalar() or 0

    # Critical signal from the current OLT batches only.
    critical_signal = db.execute(text("""
        WITH latest AS (
            SELECT olt_host, MAX(polled_at) AS latest_poll
            FROM onu_latest
            WHERE olt_host IS NOT NULL
            GROUP BY olt_host
        ),
        current_batch AS (
            SELECT o.*
            FROM onu_latest o
            JOIN latest l ON l.olt_host = o.olt_host
            WHERE o.polled_at >= l.latest_poll - INTERVAL '30 seconds'
              AND o.pon_port IS NOT NULL
              AND btrim(o.pon_port) <> ''
              AND o.onu_index IS NOT NULL
        )
        SELECT COUNT(mac_address)
        FROM current_batch
        WHERE status = 'online' AND rx_power_dbm < -27
    """)).scalar() or 0

    # Flapping: count ONUs with 3+ state transitions (online↔offline) in last 24h
    flapping = _get_flapping_count(db)

    # Bandwidth from latest snapshot batch
    bw = get_bandwidth_summary(db)

    freshness = _olt_freshness_state(db)
    staleness_seconds = freshness["staleness_seconds"]
    staleness_minutes = staleness_seconds / 60
    data_is_stale = freshness["data_is_stale"]
    source_status = freshness["source_status"]
    freshness_message = freshness["message"]

    return {
        "total_onus": (result.online or 0) + max(result.offline or 0, recent_offline),
        "online": result.online or 0,
        "offline": max(result.offline or 0, recent_offline),
        "avg_rx_power": round(result.avg_rx, 2) if result.avg_rx else None,
        "worst_rx_power": round(result.worst_rx, 2) if result.worst_rx else None,
        "alarm_count_24h": alarm_count,
        "last_poll": freshness["last_poll"] or result.last_poll,
        "olt_hosts": olt_hosts,
        "data_is_stale": data_is_stale,
        "staleness_minutes": round(min(staleness_minutes, 9999), 1),
        "live_data_available": not data_is_stale,
        "source_status": source_status,
        "freshness_message": freshness_message,
        "metrics_are_last_known": data_is_stale,
        "critical_signal": critical_signal,
        "flapping": flapping,
        "downstream_mbps": None if data_is_stale else bw["downstream_mbps"],
        "upstream_mbps": None if data_is_stale else bw["upstream_mbps"],
    }


def _get_flapping_count(db: Session) -> int:
    """
    Count ONUs with 3+ state transitions (online↔offline) in the last 24 hours.
    A state transition is when consecutive snapshots have different status values.
    Uses raw SQL for efficiency — counts adjacent-row status changes per MAC.
    """
    try:
        rows = db.execute(text("""
            WITH transitions AS (
                SELECT
                    mac_address,
                    status,
                    LAG(status) OVER (PARTITION BY mac_address ORDER BY polled_at) AS prev_status
                FROM onu_snapshots
                WHERE polled_at >= NOW() - INTERVAL '24 hours'
                  AND status IS NOT NULL
            )
            SELECT COUNT(DISTINCT mac_address)
            FROM (
                SELECT mac_address, COUNT(*) AS flip_count
                FROM transitions
                WHERE status != prev_status
                  AND prev_status IS NOT NULL
                GROUP BY mac_address
                HAVING COUNT(*) >= 3
            ) flapping
        """)).scalar() or 0
        return rows
    except Exception as e:
        logger.warning(f"Flapping count query failed: {e}")
        return 0


def get_bandwidth_summary(db: Session) -> Dict[str, Any]:
    """
    Network-wide bandwidth from the latest snapshot batch.
    Uses rx_bytes_delta / tx_bytes_delta columns from onu_snapshots.
    Converts byte deltas over the poll interval to Mbps.
    """
    try:
        freshness = _olt_freshness_state(db)
        if freshness["data_is_stale"]:
            staleness_seconds = freshness["staleness_seconds"]
            sample_age_seconds = None if staleness_seconds == float("inf") else round(staleness_seconds, 1)
            return {
                "downstream_mbps": None,
                "upstream_mbps": None,
                "per_port": [],
                "sample_window_seconds": 0,
                "data_is_stale": True,
                "sample_age_seconds": sample_age_seconds,
                "source_status": freshness["source_status"],
                "message": "Bandwidth counters are blocked because one or more OLT feeds are stale or missing.",
            }

        # Get the most recent poll timestamp
        latest_poll = db.query(func.max(models.ONULatest.polled_at)).scalar()
        if not latest_poll:
            return {
                "downstream_mbps": None,
                "upstream_mbps": None,
                "per_port": [],
                "sample_window_seconds": 0,
                "data_is_stale": True,
                "sample_age_seconds": None,
                "source_status": "unavailable",
                "message": "No OLT bandwidth sample has ever been received.",
            }

        now = datetime.now(timezone.utc)
        latest_poll_aware = latest_poll.replace(tzinfo=timezone.utc) if latest_poll.tzinfo is None else latest_poll
        sample_age_seconds = (now - latest_poll_aware).total_seconds()
        if sample_age_seconds > OLT_FRESH_CRITICAL_SECONDS:
            return {
                "downstream_mbps": None,
                "upstream_mbps": None,
                "per_port": [],
                "sample_window_seconds": 0,
                "data_is_stale": True,
                "sample_age_seconds": round(sample_age_seconds, 1),
                "source_status": "stale",
                "message": "Bandwidth counters are stale; old byte deltas are hidden to avoid false live Mbps.",
            }

        # Get snapshot batch from that poll cycle (within 30s of latest_poll)
        result = db.execute(text("""
            SELECT
                COALESCE(SUM(rx_bytes_delta), 0) AS total_rx_bytes,
                COALESCE(SUM(tx_bytes_delta), 0) AS total_tx_bytes,
                pon_port
            FROM onu_snapshots
            WHERE polled_at >= :latest_poll - INTERVAL '30 seconds'
              AND polled_at <= :latest_poll + INTERVAL '30 seconds'
              AND rx_bytes_delta IS NOT NULL
            GROUP BY pon_port
            ORDER BY pon_port
        """), {"latest_poll": latest_poll}).fetchall()

        # Poll interval — estimate from the two most recent poll timestamps
        poll_interval = 60  # default 60s
        try:
            interval_row = db.execute(text("""
                SELECT EXTRACT(EPOCH FROM (MAX(polled_at) - MIN(polled_at))) / NULLIF(COUNT(DISTINCT polled_at) - 1, 0)
                FROM (SELECT DISTINCT polled_at FROM onu_snapshots ORDER BY polled_at DESC LIMIT 5) t
            """)).scalar()
            if interval_row and interval_row > 10:
                poll_interval = int(interval_row)
        except Exception:
            pass
        total_rx = 0
        total_tx = 0
        per_port = []

        for row in result:
            rx_bytes = row[0] or 0
            tx_bytes = row[1] or 0
            port = row[2] or "unknown"
            total_rx += rx_bytes
            total_tx += tx_bytes

            # Bytes to Mbps: bytes * 8 / interval / 1_000_000
            port_down = round(rx_bytes * 8 / poll_interval / 1_000_000, 2) if poll_interval > 0 else 0
            port_up = round(tx_bytes * 8 / poll_interval / 1_000_000, 2) if poll_interval > 0 else 0
            per_port.append({"pon_port": port, "downstream_mbps": port_down, "upstream_mbps": port_up})

        downstream = round(total_rx * 8 / poll_interval / 1_000_000, 2) if poll_interval > 0 else 0
        upstream = round(total_tx * 8 / poll_interval / 1_000_000, 2) if poll_interval > 0 else 0

        return {
            "downstream_mbps": downstream,
            "upstream_mbps": upstream,
            "per_port": per_port,
            "sample_window_seconds": poll_interval,
            "data_is_stale": False,
            "sample_age_seconds": round(sample_age_seconds, 1),
            "source_status": "live",
            "message": None,
        }
    except Exception as e:
        logger.warning(f"Bandwidth query failed: {e}")
        return {
            "downstream_mbps": None,
            "upstream_mbps": None,
            "per_port": [],
            "sample_window_seconds": 0,
            "data_is_stale": True,
            "sample_age_seconds": None,
            "source_status": "error",
            "message": f"Bandwidth query failed: {e}",
        }


def get_open_tickets_for_noc(db: Session, limit: int = 20) -> Tuple[List[Dict[str, Any]], int]:
    """
    Open tickets for the NOC right panel.
    Returns tickets with customer name and fault type (from tags).
    """
    query = db.query(models.Ticket).filter(
        models.Ticket.status.in_(["Open", "In Progress", "Assigned"])
    )
    total = query.count()

    tickets = query.order_by(
        # Critical first
        case(
            (models.Ticket.priority == "Urgent", 0),
            (models.Ticket.priority == "High", 1),
            (models.Ticket.priority == "Normal", 2),
            (models.Ticket.priority == "Low", 3),
            else_=4,
        ),
        models.Ticket.created_at.desc(),
    ).limit(limit).all()

    items = []
    for t in tickets:
        # Extract fault type from tags (auto-generated tickets have tags like "auto,fiber_critical")
        fault_type = None
        if t.tags:
            for tag in t.tags.split(","):
                tag = tag.strip().upper()
                if tag in ("POWER_CUT", "FIBER_CRITICAL", "FIBER_WEAK",
                           "FIBER_FLAP", "ONU_OFFLINE", "ONLINE_CHECK_ROUTER"):
                    fault_type = tag
                    break

        # Get customer name
        customer_name = None
        if t.customer_id:
            cust = db.query(
                models.Customer.first_name, models.Customer.last_name
            ).filter(models.Customer.username == t.customer_id).first()
            if cust:
                parts = [(cust.first_name or '').strip(), (cust.last_name or '').strip()]
                customer_name = ' '.join(p for p in parts if p and p.lower() != 'nan') or None

        items.append({
            "id": t.id,
            "customer_name": customer_name,
            "issue_type": t.issue_type,
            "priority": t.priority,
            "status": t.status,
            "fault_type": fault_type,
            "created_at": t.created_at,
        })

    return items, total


def get_port_grid(db: Session, olt_host: Optional[str] = None) -> List[Dict[str, Any]]:
    """Per-PON-port breakdown: counts, avg Rx, worst Rx."""
    sql = """
        WITH latest AS (
            SELECT olt_host, MAX(polled_at) AS latest_poll
            FROM onu_latest
            WHERE olt_host IS NOT NULL
            GROUP BY olt_host
        ),
        current_batch AS (
            SELECT o.*
            FROM onu_latest o
            JOIN latest l ON l.olt_host = o.olt_host
            WHERE o.polled_at >= l.latest_poll - INTERVAL '30 seconds'
              AND o.pon_port IS NOT NULL
              AND btrim(o.pon_port) <> ''
              AND o.onu_index IS NOT NULL
        ),
        current_agg AS (
            SELECT
                pon_port,
                olt_host,
                COUNT(mac_address) AS total_current,
                COUNT(*) FILTER (WHERE status = 'online') AS online,
                COUNT(*) FILTER (WHERE status <> 'online' OR status IS NULL) AS offline_current,
                AVG(rx_power_dbm) AS avg_rx,
                MIN(rx_power_dbm) AS worst_rx,
                MAX(polled_at) AS last_poll
            FROM current_batch
            WHERE (:olt_host IS NULL OR olt_host = :olt_host)
            GROUP BY olt_host, pon_port
        ),
        recent_offline AS (
            SELECT
                pon_port,
                olt_host,
                COUNT(DISTINCT mac_address) AS offline_recent,
                MAX(polled_at) AS offline_last_poll
            FROM onu_latest
            WHERE (:olt_host IS NULL OR olt_host = :olt_host)
              AND status <> 'online'
              AND polled_at >= NOW() - INTERVAL '24 hours'
              AND pon_port IS NOT NULL
              AND btrim(pon_port) <> ''
              AND onu_index IS NOT NULL
            GROUP BY olt_host, pon_port
        )
        SELECT
            COALESCE(c.pon_port, r.pon_port) AS pon_port,
            COALESCE(c.olt_host, r.olt_host) AS olt_host,
            COALESCE(c.online, 0) + GREATEST(COALESCE(c.offline_current, 0), COALESCE(r.offline_recent, 0)) AS total,
            COALESCE(c.online, 0) AS online,
            GREATEST(COALESCE(c.offline_current, 0), COALESCE(r.offline_recent, 0)) AS offline,
            c.avg_rx,
            c.worst_rx,
            COALESCE(c.last_poll, r.offline_last_poll) AS last_poll
        FROM current_agg c
        FULL OUTER JOIN recent_offline r
          ON r.olt_host = c.olt_host AND r.pon_port = c.pon_port
        ORDER BY COALESCE(c.olt_host, r.olt_host), COALESCE(c.pon_port, r.pon_port)
    """
    rows = db.execute(text(sql), {"olt_host": olt_host}).fetchall()

    ports = []
    now = datetime.now(timezone.utc)
    freshness = _olt_freshness_state(db, now)
    problem_hosts = set(
        freshness.get("stale_hosts", [])
        + freshness.get("missing_hosts", [])
        + freshness.get("untrusted_hosts", [])
    )
    for row in rows:
        # Find worst MAC on this port
        last_poll = row.last_poll
        worst = None
        if last_poll:
            worst = db.query(models.ONULatest.mac_address).filter(
                models.ONULatest.olt_host == row.olt_host,
                models.ONULatest.pon_port == row.pon_port,
                models.ONULatest.polled_at >= last_poll - timedelta(seconds=30),
                models.ONULatest.rx_power_dbm != None,
            ).order_by(models.ONULatest.rx_power_dbm.asc()).first()

        if last_poll:
            last_poll_aware = last_poll.replace(tzinfo=timezone.utc) if last_poll.tzinfo is None else last_poll
            data_is_stale = (
                (now - last_poll_aware).total_seconds() > OLT_FRESH_CRITICAL_SECONDS
                or row.olt_host in problem_hosts
            )
        else:
            data_is_stale = True

        ports.append({
            "pon_port": row.pon_port or "unknown",
            "olt_host": row.olt_host or "",
            "total": row.total,
            "online": row.online,
            "offline": row.offline,
            "avg_rx": round(row.avg_rx, 2) if row.avg_rx else None,
            "worst_rx": round(row.worst_rx, 2) if row.worst_rx else None,
            "worst_mac": worst[0] if worst else None,
            "last_poll": last_poll,
            "data_is_stale": data_is_stale,
        })

    return ports


def get_onu_list(
    db: Session,
    page: int = 1,
    page_size: int = 50,
    status: Optional[str] = None,
    pon_port: Optional[str] = None,
    olt_host: Optional[str] = None,
    search: Optional[str] = None,
    signal_max: Optional[float] = None,
    linked: Optional[str] = None,
) -> Tuple[List[Dict[str, Any]], int]:
    """Paginated ONU list with filters. Returns (items, total_count)."""
    query = db.query(models.ONULatest)

    if status:
        query = query.filter(models.ONULatest.status == status)
    if pon_port:
        query = query.filter(models.ONULatest.pon_port == pon_port)
    if olt_host:
        query = query.filter(models.ONULatest.olt_host == olt_host)
    if search:
        query = query.filter(models.ONULatest.mac_address.ilike(f"%{search}%"))
    if signal_max is not None:
        query = query.filter(models.ONULatest.rx_power_dbm <= signal_max)

    # Load customer index once — used for both linked filter and item enrichment
    cust_index = _load_customer_index(db)
    pg_location_by_customer = {
        room.username: {
            "lat": room.building.gps_lat,
            "lng": room.building.gps_lng,
            "building_id": room.building_id,
            "building_name": room.building.name,
            "room_number": room.room_number,
        }
        for room in db.query(models.PGRoom)
        .join(models.PGBuilding, models.PGBuilding.id == models.PGRoom.building_id)
        .filter(
            models.PGRoom.username.isnot(None),
            models.PGBuilding.gps_lat.isnot(None),
            models.PGBuilding.gps_lng.isnot(None),
        )
        .all()
        if room.username
    }

    if linked in ("linked", "unlinked"):
        all_onus_for_match = db.query(
            models.ONULatest.mac_address,
            models.ONULatest.olt_host,
            models.ONULatest.pon_port,
            models.ONULatest.onu_index,
        ).filter(models.ONULatest.mac_address.isnot(None)).all()
        matched_macs = {
            row.mac_address for row in all_onus_for_match
            if find_customer_for_observed_onu(
                db,
                row.mac_address,
                olt_host=row.olt_host,
                pon_port=row.pon_port,
                onu_index=row.onu_index,
            ) is not None
            or _fuzzy_find_customer(cust_index, row.mac_address) is not None
        }
        if linked == "unlinked":
            query = query.filter(~models.ONULatest.mac_address.in_(matched_macs))
        else:
            query = query.filter(models.ONULatest.mac_address.in_(matched_macs))

    total = query.count()

    onus = query.order_by(
        models.ONULatest.rx_power_dbm.asc().nullslast()
    ).offset((page - 1) * page_size).limit(page_size).all()

    items = []
    for o in onus:
        c = _fuzzy_find_customer(cust_index, o.mac_address) or find_customer_for_observed_onu(
            db,
            o.mac_address,
            olt_host=o.olt_host,
            pon_port=o.pon_port,
            onu_index=o.onu_index,
        )
        items.append({
            "mac_address": o.mac_address,
            "olt_host": o.olt_host,
            "pon_port": o.pon_port,
            "onu_index": o.onu_index,
            "status": o.status,
            "rx_power_dbm": o.rx_power_dbm,
            "tx_power_dbm": o.tx_power_dbm,
            "temperature_c": o.temperature_c,
            "voltage_mv": o.voltage_mv,
            "dying_gasp": o.dying_gasp,
            "polled_at": o.polled_at,
            "customer_name": _customer_name(c),
            "customer_phone": c.phone if c else None,
            "customer_plan": c.plan_name if c else None,
        })

    return items, total


def get_onu_detail(db: Session, mac: str) -> Optional[Dict[str, Any]]:
    """
    Single ONU full profile:
    - Live signal (Rx/Tx/Temp/Voltage/DyingGasp)
    - 24h signal history
    - Alarm counts (24h and 30d)
    - Flap count (offline events in 30d)
    - Prediction data (health score, fiber/churn risk, recommended action)
    - Latest bandwidth snapshot
    - Device info (vendor, model, hw/sw version)
    - Linked customer (trusted binding first, legacy fuzzy MAC bridge fallback)
    """
    onu = db.query(models.ONULatest).filter(
        models.ONULatest.mac_address == mac
    ).first()
    if not onu:
        return None

    now = datetime.now(timezone.utc)
    since_24h = now - timedelta(hours=24)
    since_30d = now - timedelta(days=30)

    # Trusted binding lookup, then legacy fuzzy bridge fallback. The binding is
    # returned to the UI so operators know whether the customer match is trusted.
    binding = find_active_binding_for_observed_onu(
        db,
        mac,
        olt_host=onu.olt_host,
        pon_port=onu.pon_port,
        onu_index=onu.onu_index,
    )
    customer = None
    customer_match_source = "none"
    if binding:
        customer = db.query(models.Customer).filter(
            models.Customer.username == binding.customer_id
        ).first()
        customer_match_source = "trusted_binding" if customer else "binding_missing_customer"
    else:
        cust_index = _load_customer_index(db)
        candidate_customer = _fuzzy_find_customer(cust_index, mac)
        if candidate_customer:
            active_customer_binding = _active_binding_for_customer(db, candidate_customer.username)
            if active_customer_binding and not _binding_matches_observed_identity(active_customer_binding, mac):
                logger.warning(
                    "Suppressed legacy fuzzy match: ONU %s would map to %s, but active binding is %s",
                    mac,
                    candidate_customer.username,
                    active_customer_binding.onu_identifier,
                )
                customer_match_source = "legacy_suppressed_active_binding_mismatch"
            else:
                customer_match_source = "railwire_discovery_clue"
        else:
            customer_match_source = "none"
    customer_name = _customer_name(customer)

    # 24h signal history from onu_snapshots
    history = db.query(
        models.ONUSnapshot.polled_at,
        models.ONUSnapshot.rx_power_dbm,
        models.ONUSnapshot.tx_power_dbm,
        models.ONUSnapshot.status,
    ).filter(
        models.ONUSnapshot.mac_address == mac,
        models.ONUSnapshot.polled_at >= since_24h,
    ).order_by(models.ONUSnapshot.polled_at.asc()).all()

    # Alarm counts
    alarm_24h = db.query(func.count(models.AlarmEvent.id)).filter(
        models.AlarmEvent.mac_address == mac,
        models.AlarmEvent.received_at >= since_24h,
    ).scalar() or 0

    alarm_30d = db.query(func.count(models.AlarmEvent.id)).filter(
        models.AlarmEvent.mac_address == mac,
        models.AlarmEvent.received_at >= since_30d,
    ).scalar() or 0

    flap_count_30d = db.query(func.count(models.AlarmEvent.id)).filter(
        models.AlarmEvent.mac_address == mac,
        models.AlarmEvent.event_type == "ONU_OFFLINE",
        models.AlarmEvent.received_at >= since_30d,
    ).scalar() or 0

    open_alarms = db.query(func.count(models.AlarmEvent.id)).filter(
        models.AlarmEvent.mac_address == mac,
        models.AlarmEvent.status == "open",
    ).scalar() or 0

    # Prediction data
    pred_row = db.execute(text("""
        SELECT health_score, fiber_risk, churn_risk, recommended_action,
               rx_slope_7d, rx_avg_7d, last_computed
        FROM predictions WHERE mac_address = :mac
    """), {"mac": mac}).fetchone()
    prediction = None
    if pred_row:
        prediction = {
            "health_score": pred_row[0],
            "fiber_risk": pred_row[1],
            "churn_risk": pred_row[2],
            "recommended_action": pred_row[3],
            "rx_slope_7d": pred_row[4],
            "rx_avg_7d": pred_row[5],
            "last_computed": pred_row[6].isoformat() if pred_row[6] else None,
        }

    # Latest bandwidth from most recent snapshot — use actual poll interval
    bw_rows = db.execute(text("""
        SELECT rx_bytes_delta, tx_bytes_delta, polled_at
        FROM onu_snapshots
        WHERE mac_address = :mac AND rx_bytes_delta IS NOT NULL AND rx_bytes_delta > 0
        ORDER BY polled_at DESC LIMIT 2
    """), {"mac": mac}).fetchall()
    bandwidth = None
    if bw_rows and bw_rows[0][0]:
        bw_row = bw_rows[0]
        # Compute interval from the two most recent snapshots; fall back to 90s
        poll_interval_s = 90
        if len(bw_rows) == 2:
            delta = (bw_rows[0][2] - bw_rows[1][2]).total_seconds()
            if 20 < delta < 600:
                poll_interval_s = delta
        bandwidth = {
            "rx_mbps": round(bw_row[0] * 8 / poll_interval_s / 1_000_000, 3),
            "tx_mbps": round((bw_row[1] or 0) * 8 / poll_interval_s / 1_000_000, 3),
            "sampled_at": bw_row[2].isoformat() if bw_row[2] else None,
        }

    # Valid geo coords
    geo_lat = None
    geo_long = None
    if customer and customer.geo_lat and customer.geo_long:
        if abs(customer.geo_lat) > 0.1 and abs(customer.geo_long) > 0.1:
            geo_lat = float(customer.geo_lat)
            geo_long = float(customer.geo_long)

    # Device info
    is_gpon = mac.startswith("SN:")
    signal_available = not is_gpon  # GPON CLI doesn't expose signal yet

    return {
        "mac_address": onu.mac_address,
        "olt_host": onu.olt_host,
        "pon_port": onu.pon_port,
        "onu_index": onu.onu_index,
        "status": onu.status,
        "rx_power_dbm": onu.rx_power_dbm,
        "tx_power_dbm": onu.tx_power_dbm,
        "temperature_c": onu.temperature_c,
        "voltage_mv": onu.voltage_mv,
        "dying_gasp": onu.dying_gasp,
        "polled_at": onu.polled_at,
        "vendor_id": onu.vendor_id,
        "model_id": onu.model_id,
        "hw_version": onu.hw_version,
        "sw_version": onu.sw_version,
        "is_gpon": is_gpon,
        "signal_available": signal_available,
        # Alarm / event counts
        "alarm_count_24h": alarm_24h,
        "alarm_count_30d": alarm_30d,
        "flap_count_30d": flap_count_30d,
        "open_alarms": open_alarms,
        # Prediction intelligence
        "prediction": prediction,
        # Bandwidth
        "bandwidth": bandwidth,
        # Customer
        "customer_name": customer_name,
        "customer_phone": customer.phone if customer else None,
        "customer_plan": customer.plan_name if customer else None,
        "customer_expiry": customer.expiry_date if customer else None,
        "customer_status": customer.status if customer else None,
        "customer_balance": float(customer.balance) if customer and customer.balance else None,
        "customer_address": customer.railwire_address if customer else None,
        "customer_geo_lat": geo_lat,
        "customer_geo_long": geo_long,
        "customer_id": customer.id if customer else None,
        "customer_match_source": customer_match_source,
        # Trusted ONU binding metadata
        "binding_id": binding.id if binding else None,
        "binding_customer_id": binding.customer_id if binding else None,
        "binding_active": bool(binding.is_active) if binding else False,
        "binding_source": binding.binding_source if binding else None,
        "binding_confidence": binding.confidence if binding else None,
        "binding_primary_identifier_type": binding.primary_identifier_type if binding else None,
        "binding_serial_number": binding.serial_number if binding else None,
        "binding_mac_address": binding.mac_address if binding else None,
        "binding_verified_at": binding.verified_at if binding else None,
        "binding_sticker_photo_url": binding.sticker_photo_url if binding else None,
        "history_24h": [
            {
                "timestamp": h.polled_at,
                "rx_power_dbm": h.rx_power_dbm,
                "tx_power_dbm": h.tx_power_dbm,
                "status": h.status,
            }
            for h in history
        ],
    }


def get_signal_history(
    db: Session, mac: str, hours: int = 24
) -> List[Dict[str, Any]]:
    """Time-series signal data for a single ONU, including bandwidth deltas."""
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    rows = db.query(
        models.ONUSnapshot.polled_at,
        models.ONUSnapshot.rx_power_dbm,
        models.ONUSnapshot.tx_power_dbm,
        models.ONUSnapshot.status,
        models.ONUSnapshot.rx_bytes_delta,
        models.ONUSnapshot.tx_bytes_delta,
        models.ONUSnapshot.distance_m,
    ).filter(
        models.ONUSnapshot.mac_address == mac,
        models.ONUSnapshot.polled_at >= since,
    ).order_by(models.ONUSnapshot.polled_at.asc()).all()

    result = []
    prev_ts = None
    for r in rows:
        interval_sec = None
        if prev_ts and r.polled_at:
            interval_sec = (r.polled_at - prev_ts).total_seconds()
        # Compute Mbps only when interval is sane (60s–3600s) and bytes > 0
        rx_mbps = None
        tx_mbps = None
        if interval_sec and 60 <= interval_sec <= 3600:
            if r.rx_bytes_delta and r.rx_bytes_delta > 0:
                v = r.rx_bytes_delta * 8 / interval_sec / 1_000_000
                if v <= 250:  # filter impossible values
                    rx_mbps = round(v, 2)
            if r.tx_bytes_delta and r.tx_bytes_delta > 0:
                v = r.tx_bytes_delta * 8 / interval_sec / 1_000_000
                if v <= 250:
                    tx_mbps = round(v, 2)
        result.append({
            "timestamp": r.polled_at,
            "rx_power_dbm": r.rx_power_dbm,
            "tx_power_dbm": r.tx_power_dbm,
            "status": r.status,
            "rx_mbps": rx_mbps,
            "tx_mbps": tx_mbps,
            "distance_m": r.distance_m,
        })
        prev_ts = r.polled_at
    return result


def get_alarm_feed(
    db: Session,
    page: int = 1,
    page_size: int = 50,
    event_type: Optional[str] = None,
    pon_port: Optional[str] = None,
    hours: Optional[int] = None,
    status: Optional[str] = None,
    mac_address: Optional[str] = None,
) -> Tuple[List[Dict[str, Any]], int]:
    """Paginated alarm feed with filters.

    status: 'open' | 'resolved' | None (all).
    Defaults to 'open' at the router level so the page shows actionable alarms.
    mac_address: filter to a single ONU's alarm history.
    """
    query = db.query(models.AlarmEvent)

    if event_type:
        query = query.filter(models.AlarmEvent.event_type == event_type)
    if pon_port:
        query = query.filter(models.AlarmEvent.pon_port == pon_port)
    if mac_address:
        query = query.filter(models.AlarmEvent.mac_address == mac_address)
    if hours:
        since = datetime.now(timezone.utc) - timedelta(hours=hours)
        query = query.filter(models.AlarmEvent.received_at >= since)
    if status:
        query = query.filter(models.AlarmEvent.status == status)

    total = query.count()

    alarms = query.order_by(
        models.AlarmEvent.received_at.desc()
    ).offset((page - 1) * page_size).limit(page_size).all()

    # Customer lookup via fuzzy MAC offset matching (PPPoE MAC = ONU MAC + offset)
    cust_index = _load_customer_index(db)

    items = []
    for a in alarms:
        c = _fuzzy_find_customer(cust_index, a.mac_address)
        items.append({
            "id": a.id,
            "mac_address": a.mac_address,
            "event_type": a.event_type,
            "olt_host": a.olt_host,
            "pon_port": a.pon_port,
            "onu_index": a.onu_index,
            "received_at": a.received_at,
            "customer_name": _customer_name(c),
            "customer_phone": c.phone if c else None,
            "status": a.status or "open",
            "occurrence_count": a.occurrence_count or 1,
            "resolved_at": a.resolved_at,
            "duration_seconds": a.duration_seconds,
        })

    return items, total


def get_network_history(db: Session, hours: int = 6) -> List[Dict[str, Any]]:
    """
    Network-wide avg Rx power in 5-minute buckets for the signal trend chart.
    Returns list of {timestamp, avg_rx, min_rx, online_count, total_count}.
    """
    rows = db.execute(text("""
        SELECT
            date_trunc('minute', polled_at) -
            MOD(EXTRACT(minute FROM polled_at)::int, 5) * interval '1 minute' AS bucket,
            ROUND(AVG(rx_power_dbm)::numeric, 2) AS avg_rx,
            ROUND(MIN(rx_power_dbm)::numeric, 2) AS min_rx,
            COUNT(*) FILTER (WHERE status = 'online') AS online_count,
            COUNT(*) AS total_count
        FROM onu_snapshots
        WHERE polled_at >= NOW() - :hours * interval '1 hour'
          AND rx_power_dbm IS NOT NULL
        GROUP BY bucket
        ORDER BY bucket
    """), {"hours": hours}).fetchall()

    return [
        {
            "timestamp": row.bucket.isoformat(),
            "avg_rx": float(row.avg_rx) if row.avg_rx else None,
            "min_rx": float(row.min_rx) if row.min_rx else None,
            "online_count": int(row.online_count),
            "total_count": int(row.total_count),
        }
        for row in rows
    ]


def detect_outages(db: Session) -> List[Dict[str, Any]]:
    """
    Dual-strategy outage detection.

    Strategy A — Port threshold:
        If 3+ ONUs offline on the same (olt_host, pon_port) AND ≥15% of that port → outage.
        Good for: fiber cut on a single PON cable, OLT port hardware failure.

    Strategy B — Time correlation (cross-port):
        If N≥8 ONUs across any combination of ports went OFFLINE within a 3-minute
        window in the last 20 minutes → area event (power cut, feeder cable).
        Since our ports are NOT wired by geographic area, port-based detection alone
        misses whole-area power failures that affect ONUs on multiple ports equally.

    Both strategies return the same shape so the frontend handles them identically.
    Deduplication: if a port-based outage already covers an event, don't double-count.
    """
    outages: List[Dict[str, Any]] = []

    # ── Strategy A: Port threshold ──────────────────────────────────────────
    port_rows = db.query(
        models.ONULatest.olt_host,
        models.ONULatest.pon_port,
        func.count(models.ONULatest.mac_address).label("total"),
        func.count(case((models.ONULatest.status != "online", 1))).label("offline"),
    ).group_by(
        models.ONULatest.olt_host,
        models.ONULatest.pon_port,
    ).all()

    port_outage_macs: set = set()   # track which MACs are already in a port outage

    for row in port_rows:
        if row.offline < 3:
            continue
        pct = (row.offline / row.total * 100) if row.total > 0 else 0
        if pct < 15:
            continue

        if pct >= 90:
            severity = "TOTAL"
        elif row.offline >= 15 or pct >= 50:
            severity = "CRITICAL"
        elif row.offline >= 6 or pct >= 25:
            severity = "MAJOR"
        else:
            severity = "MINOR"

        offline_macs = [
            m[0] for m in db.query(models.ONULatest.mac_address).filter(
                models.ONULatest.olt_host == row.olt_host,
                models.ONULatest.pon_port == row.pon_port,
                models.ONULatest.status != "online",
            ).all()
        ]
        port_outage_macs.update(offline_macs)

        outages.append({
            "pon_port": row.pon_port or "unknown",
            "olt_host": row.olt_host or "",
            "affected_count": row.offline,
            "total_count": row.total,
            "severity": severity,
            "offline_macs": offline_macs,
            "detection": "PORT",
        })

    # ── Strategy B: Time-correlation (cross-port concurrent offline) ────────
    # Find bursts: 8+ OFFLINE/DYING_GASP alarms from the same OLT within any
    # 3-minute rolling window in the last 20 minutes.
    # We bucket alarms into 3-minute slots by truncating to floor(minute/3)*3.
    window_rows = db.execute(text("""
        SELECT
            olt_host,
            date_trunc('hour', received_at)
                + INTERVAL '3 min' * (EXTRACT(minute FROM received_at)::int / 3) AS bucket,
            COUNT(DISTINCT mac_address) AS affected,
            array_agg(DISTINCT mac_address) AS macs,
            array_agg(DISTINCT COALESCE(pon_port, 'unknown')) AS ports
        FROM alarm_events
        WHERE event_type IN ('ONU_OFFLINE', 'DYING_GASP', 'FIBER_CRITICAL')
          AND received_at >= NOW() - INTERVAL '20 minutes'
        GROUP BY olt_host, bucket
        HAVING COUNT(DISTINCT mac_address) >= 8
        ORDER BY bucket DESC
    """)).fetchall()

    # Deduplicate: keep only the worst (highest affected_count) CONCURRENT event per OLT.
    # Multiple 3-min buckets fire for the same underlying event — only the peak matters.
    best_concurrent: Dict[str, Any] = {}  # olt_host -> best row
    for wrow in window_rows:
        olt = wrow[0] or ""
        affected = wrow[2]
        if olt not in best_concurrent or affected > best_concurrent[olt][2]:
            best_concurrent[olt] = wrow

    for wrow in best_concurrent.values():
        macs = list(wrow[3]) if wrow[3] else []
        ports = sorted(set(p for p in (wrow[4] or []) if p))
        affected = wrow[2]

        # Skip if these MACs are already fully covered by port-based outages
        new_macs = [m for m in macs if m not in port_outage_macs]
        if len(new_macs) < 4:
            continue

        if affected >= 30:
            severity = "CRITICAL"
        elif affected >= 15:
            severity = "MAJOR"
        else:
            severity = "MINOR"

        total_on_olt = db.query(func.count(models.ONULatest.mac_address)).filter(
            models.ONULatest.olt_host == wrow[0]
        ).scalar() or 0

        outages.append({
            "pon_port": ", ".join(ports[:4]) + (" +" if len(ports) > 4 else ""),
            "olt_host": wrow[0] or "",
            "affected_count": affected,
            "total_count": total_on_olt,
            "severity": severity,
            "offline_macs": macs,
            "detection": "CONCURRENT",
        })

    return outages


def get_heatmap_data(db: Session) -> List[Dict[str, Any]]:
    """
    All ONUs with coordinates for the signal heatmap.

    Coordinate priority (three tiers):
      1. GPS verified  — customer.gps_lat/gps_lng from survey, then geo_lat/geo_long (exact)
      2. Area-level    — customer address parsed against _AREA_COORDS lookup (±300m)
      3. PON cluster   — ONU's PON port cluster center with MAC-hash jitter (±600m)

    Tier 1 sets has_exact_location=True; tiers 2 and 3 set it False.
    The map renders tier-2 dots slightly larger/brighter to distinguish them from
    pure cluster dots without claiming false precision.

    Improvement path for better positions:
      - Field techs record GPS on customer visits (Expo app → customer.gps_lat/gps_lng)
      - Admin pastes WhatsApp live-location coordinates into customer profile
      - Nightly Nominatim geocode once Google Maps / OSM covers local streets
    """
    onus = db.query(models.ONULatest).all()
    cust_index = _load_customer_index(db)
    pg_location_by_customer = {
        room.username: {
            "lat": room.building.gps_lat,
            "lng": room.building.gps_lng,
            "building_id": room.building_id,
            "building_name": room.building.name,
            "room_number": room.room_number,
        }
        for room in db.query(models.PGRoom)
        .join(models.PGBuilding, models.PGBuilding.id == models.PGRoom.building_id)
        .filter(
            models.PGRoom.username.isnot(None),
            models.PGBuilding.gps_lat.isnot(None),
            models.PGBuilding.gps_lng.isnot(None),
        )
        .all()
        if room.username
    }

    points = []
    for o in onus:
        c = _fuzzy_find_customer(cust_index, o.mac_address) or find_customer_for_observed_onu(
            db,
            o.mac_address,
            olt_host=o.olt_host,
            pon_port=o.pon_port,
            onu_index=o.onu_index,
        )

        lat, lng, has_exact = None, None, False
        location_tier = 3  # 1=GPS, 2=area, 3=cluster
        location_source = "pon_cluster"
        pg_meta = None

        if c and c.username in pg_location_by_customer:
            pg_meta = pg_location_by_customer[c.username]
            try:
                room_lat_jitter, room_lng_jitter = _cluster_jitter(o.mac_address, radius_deg=0.00018)
                lat = float(pg_meta["lat"]) + room_lat_jitter
                lng = float(pg_meta["lng"]) + room_lng_jitter
                has_exact = True
                location_tier = 1
                location_source = "pg_building"
            except (TypeError, ValueError):
                lat, lng = None, None

        # ── Tier 1: verified customer coordinates from field survey/admin ──
        if c and lat is None:
            for lat_value, lng_value in ((c.gps_lat, c.gps_lng), (c.geo_lat, c.geo_long)):
                try:
                    glat, glng = float(lat_value), float(lng_value)
                    if abs(glat) > 0.1 and abs(glng) > 0.1:
                        lat, lng = glat, glng
                        has_exact = True
                        location_tier = 1
                        location_source = "field_gps" if lat_value == c.gps_lat else "legacy_geo"
                        break
                except (TypeError, ValueError):
                    pass

        # ── Tier 2: Area-level from railwire_address ──
        if not has_exact and c and c.railwire_address:
            area = _extract_area_coords(c.railwire_address)
            if area:
                # Jitter by MAC hash so two customers in the same area
                # don't stack on top of each other
                jlat, jlng = _cluster_jitter(o.mac_address, radius_deg=_AREA_JITTER_RADIUS)
                lat = area[0] + jlat
                lng = area[1] + jlng
                location_tier = 2
                location_source = "address_area"

        # ── Tier 3: PON port cluster (no customer address available) ──
        if lat is None:
            norm = (o.pon_port or '').lower().replace('epon', '').replace('gpon', '')
            if not norm.startswith('0/'):
                norm = '0/' + norm.lstrip('0').lstrip('/')
            cluster = _PORT_CLUSTER_COORDS.get(norm)
            if cluster:
                jlat, jlng = _cluster_jitter(o.mac_address)
                lat = cluster[0] + jlat
                lng = cluster[1] + jlng
                location_source = "pon_cluster"

        if lat is None:
            continue

        points.append({
            "mac_address": o.mac_address,
            "pon_port": o.pon_port,
            "olt_host": o.olt_host,
            "status": o.status,
            "rx_power_dbm": o.rx_power_dbm,
            "customer_username": c.username if c else None,
            "customer_name": _customer_name(c),
            "customer_phone": c.phone if c else None,
            "customer_plan": c.plan_name if c else None,
            "lat": lat,
            "lng": lng,
            "has_exact_location": has_exact,
            "location_tier": location_tier,
            "location_source": location_source,
            "pg_building_id": pg_meta["building_id"] if pg_meta else None,
            "pg_building_name": pg_meta["building_name"] if pg_meta else None,
            "pg_room_number": pg_meta["room_number"] if pg_meta else None,
        })

    return points


# =========================================================================
# CUSTOMER INTELLIGENCE
# =========================================================================

def _signal_level(rx: Optional[float]) -> str:
    """Classify Rx power into human-readable level."""
    if rx is None:
        return "unknown"
    if rx >= -20:
        return "excellent"
    if rx >= -24:
        return "good"
    if rx >= -27:
        return "weak"
    return "critical"


def _compute_health(
    onu_status: Optional[str],
    rx: Optional[float],
    expiry_date: Optional[Any],
    alarm_count: int,
    balance: Optional[float],
) -> Tuple[int, List[str]]:
    """
    Compute customer health score 0-100. Higher = healthier.
    Returns (score, list_of_negative_factors).
    """
    score = 100
    factors = []

    # Signal quality (max -40 pts)
    if rx is None:
        score -= 15
        factors.append("No signal data")
    elif rx < -27:
        score -= 40
        factors.append(f"Critical signal ({rx:.1f} dBm)")
    elif rx < -24:
        score -= 20
        factors.append(f"Weak signal ({rx:.1f} dBm)")
    elif rx < -20:
        score -= 5

    # Online status (max -30 pts)
    if onu_status == "offline":
        score -= 30
        factors.append("ONU offline")
    elif onu_status is None:
        score -= 10
        factors.append("ONU not linked")

    # Expiry (max -15 pts)
    if expiry_date:
        now = datetime.now(timezone.utc)
        exp = expiry_date.replace(tzinfo=timezone.utc) if expiry_date.tzinfo is None else expiry_date
        days_left = (exp - now).days
        if days_left < 0:
            score -= 15
            factors.append(f"Expired {abs(days_left)}d ago")
        elif days_left < 3:
            score -= 10
            factors.append(f"Expiring in {days_left}d")
        elif days_left < 7:
            score -= 5
            factors.append(f"Expiring in {days_left}d")

    # Alarms (max -10 pts)
    if alarm_count >= 5:
        score -= 10
        factors.append(f"{alarm_count} alarms in 24h")
    elif alarm_count >= 2:
        score -= 5
        factors.append(f"{alarm_count} alarms in 24h")

    # Low balance (max -5 pts)
    if balance is not None and balance < 10:
        score -= 5
        factors.append(f"Low balance (₹{balance:.0f})")

    return max(0, score), factors


def _classify_fault(
    status: Optional[str],
    rx: Optional[float],
    dying_gasp: bool,
    flap_count: Optional[int],
) -> Tuple[str, str, str, int]:
    """
    Classify an ONU's current state into a fault type.
    Returns (fault_type, severity, suggested_action, priority).
    Priority: 1=immediate, 2=urgent, 3=schedule, 4=monitor.
    """
    if dying_gasp:
        return (
            "POWER_CUT",
            "HIGH",
            "Customer power outage. Call customer — do NOT dispatch tech.",
            2,
        )
    if status == "offline":
        if rx is not None and rx < -27:
            return (
                "FIBER_CRITICAL_OFFLINE",
                "CRITICAL",
                "Offline with critical signal. Dispatch with OTDR + fiber kit immediately.",
                1,
            )
        return (
            "ONU_OFFLINE",
            "HIGH",
            "ONU offline, no dying gasp. Try remote reboot first. If fails, check power and fiber.",
            2,
        )
    # Online but problems
    if rx is not None:
        if rx < -27:
            return (
                "FIBER_CRITICAL",
                "CRITICAL",
                "Signal critically weak. Dispatch with OTDR + fiber kit. Check splices and connector.",
                1,
            )
        if rx < -24:
            return (
                "FIBER_WEAK",
                "MEDIUM",
                "Signal degrading. Schedule maintenance within 48 hours. Check connector and splitter.",
                3,
            )
    if flap_count is not None and flap_count > 10:
        return (
            "FIBER_FLAP",
            "MEDIUM",
            "ONU flapping frequently. Check fiber splice, connector, or loose cable.",
            3,
        )
    return ("HEALTHY", "OK", "", 5)


def get_active_faults(db: Session) -> Dict[str, Any]:
    """
    Triage view: all ONUs with active faults, classified and sorted by priority.
    """
    # Load all ONUs
    onus = db.query(models.ONULatest).all()

    # Load customer index
    cust_idx = _load_customer_index(db)

    # Get alarm counts per MAC in last 24h
    cutoff_24h = datetime.now(timezone.utc) - timedelta(hours=24)
    alarm_counts = dict(
        db.query(
            models.AlarmEvent.mac_address,
            func.count(models.AlarmEvent.id),
        ).filter(
            models.AlarmEvent.created_at >= cutoff_24h,
        ).group_by(models.AlarmEvent.mac_address).all()
    )

    # Get flap counts from recent alarm events (count status transitions)
    flap_counts = dict(
        db.query(
            models.AlarmEvent.mac_address,
            func.count(models.AlarmEvent.id),
        ).filter(
            models.AlarmEvent.created_at >= cutoff_24h,
            models.AlarmEvent.event_type == "ONU_OFFLINE",
        ).group_by(models.AlarmEvent.mac_address).all()
    )

    faults = []
    severity_counts = {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "OK": 0}

    for onu in onus:
        fault_type, severity, action, priority = _classify_fault(
            onu.status,
            onu.rx_power_dbm,
            onu.dying_gasp,
            flap_counts.get(onu.mac_address, 0),
        )

        if fault_type == "HEALTHY":
            severity_counts["OK"] += 1
            continue

        cust = _fuzzy_find_customer(cust_idx, onu.mac_address)
        alarm_ct = alarm_counts.get(onu.mac_address, 0)

        faults.append({
            "mac_address": onu.mac_address,
            "olt_host": onu.olt_host,
            "pon_port": onu.pon_port,
            "onu_index": onu.onu_index,
            "status": onu.status,
            "rx_power_dbm": round(onu.rx_power_dbm, 2) if onu.rx_power_dbm else None,
            "tx_power_dbm": round(onu.tx_power_dbm, 2) if onu.tx_power_dbm else None,
            "temperature_c": round(onu.temperature_c, 1) if onu.temperature_c else None,
            "dying_gasp": onu.dying_gasp,
            "fault_type": fault_type,
            "severity": severity,
            "action": action,
            "priority": priority,
            "alarm_count_24h": alarm_ct,
            "customer_name": _customer_name(cust),
            "customer_phone": cust.phone if cust else None,
            "polled_at": onu.polled_at.isoformat() if onu.polled_at else None,
        })

        severity_counts[severity] = severity_counts.get(severity, 0) + 1

    # Sort by priority (lower = more urgent), then alarm count desc
    faults.sort(key=lambda f: (f["priority"], -f["alarm_count_24h"]))

    # Group by fault type for summary
    fault_summary: Dict[str, int] = {}
    for f in faults:
        ft = f["fault_type"]
        fault_summary[ft] = fault_summary.get(ft, 0) + 1

    return {
        "summary": {
            "total_faults": len(faults),
            "total_healthy": severity_counts["OK"],
            "critical": severity_counts.get("CRITICAL", 0),
            "high": severity_counts.get("HIGH", 0),
            "medium": severity_counts.get("MEDIUM", 0),
        },
        "fault_breakdown": [
            {"fault_type": ft, "count": ct}
            for ft, ct in sorted(fault_summary.items(), key=lambda x: -x[1])
        ],
        "faults": faults,
    }


def get_network_analytics(db: Session, days: int = 7) -> Dict[str, Any]:
    """
    Network analytics: alarm trends, top problematic ONUs, uptime SLA,
    signal degradation tracking.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    # --- Alarm breakdown by type ---
    alarm_by_type = db.execute(text(
        """SELECT event_type, COUNT(*) as cnt
           FROM alarm_events WHERE created_at >= :cutoff
           GROUP BY event_type ORDER BY cnt DESC"""
    ), {"cutoff": cutoff}).fetchall()

    # --- Alarm trend by day ---
    alarm_by_day = db.execute(text(
        """SELECT created_at::date as day, event_type, COUNT(*) as cnt
           FROM alarm_events WHERE created_at >= :cutoff
           GROUP BY day, event_type ORDER BY day"""
    ), {"cutoff": cutoff}).fetchall()

    alarm_trend: Dict[str, Dict[str, int]] = {}
    for row in alarm_by_day:
        d = str(row[0])
        if d not in alarm_trend:
            alarm_trend[d] = {}
        alarm_trend[d][row[1]] = row[2]

    # --- Alarm breakdown by port ---
    alarm_by_port = db.execute(text(
        """SELECT pon_port, COUNT(*) as cnt
           FROM alarm_events WHERE created_at >= :cutoff AND pon_port IS NOT NULL
           GROUP BY pon_port ORDER BY pon_port"""
    ), {"cutoff": cutoff}).fetchall()

    # --- Top problematic ONUs (most alarms) ---
    top_alarm_onus = db.execute(text(
        """SELECT ae.mac_address, COUNT(*) as alarm_count,
                  ol.pon_port, ol.status, ol.rx_power_dbm
           FROM alarm_events ae
           LEFT JOIN onu_latest ol ON ae.mac_address = ol.mac_address
           WHERE ae.created_at >= :cutoff
           GROUP BY ae.mac_address, ol.pon_port, ol.status, ol.rx_power_dbm
           ORDER BY alarm_count DESC
           LIMIT 15"""
    ), {"cutoff": cutoff}).fetchall()

    # Build customer index for names
    cust_idx = _load_customer_index(db)

    problem_onus = []
    for row in top_alarm_onus:
        mac = row[0]
        cust = _fuzzy_find_customer(cust_idx, mac)
        problem_onus.append({
            "mac_address": mac,
            "alarm_count": row[1],
            "pon_port": row[2],
            "status": row[3],
            "rx_power_dbm": round(row[4], 2) if row[4] else None,
            "customer_name": _customer_name(cust),
            "customer_phone": cust.phone if cust else None,
        })

    # --- Daily uptime SLA from onu_daily ---
    uptime_sla = []
    try:
        daily_rows = db.execute(text(
            """SELECT day, AVG(online_pct) as avg_uptime,
                      MIN(online_pct) as worst_uptime,
                      COUNT(*) as onu_count,
                      COUNT(*) FILTER (WHERE online_pct >= 99) as sla_99_count,
                      COUNT(*) FILTER (WHERE online_pct >= 95) as sla_95_count,
                      AVG(avg_rx) as avg_rx
               FROM onu_daily
               GROUP BY day ORDER BY day"""
        )).fetchall()
        for row in daily_rows:
            total = row[3] or 1
            uptime_sla.append({
                "date": str(row[0]),
                "avg_uptime": round(row[1], 2) if row[1] else None,
                "worst_uptime": round(row[2], 2) if row[2] else None,
                "onu_count": row[3],
                "sla_99_pct": round((row[4] / total) * 100, 1),
                "sla_95_pct": round((row[5] / total) * 100, 1),
                "avg_rx": round(row[6], 2) if row[6] else None,
            })
    except Exception:
        pass

    # --- Worst uptime ONUs ---
    worst_uptime = []
    try:
        worst_rows = db.execute(text(
            """SELECT mac_address, AVG(online_pct) as avg_uptime, COUNT(*) as days
               FROM onu_daily
               GROUP BY mac_address
               HAVING COUNT(*) >= 2
               ORDER BY AVG(online_pct) ASC
               LIMIT 10"""
        )).fetchall()
        for row in worst_rows:
            mac = row[0]
            cust = _fuzzy_find_customer(cust_idx, mac)
            worst_uptime.append({
                "mac_address": mac,
                "avg_uptime": round(row[1], 2) if row[1] else 0,
                "days_tracked": row[2],
                "customer_name": _customer_name(cust),
            })
    except Exception:
        pass

    # --- Signal degradation (ONUs whose Rx got worse) ---
    degradation = []
    try:
        deg_rows = db.execute(text(
            """SELECT a.mac_address, a.avg_rx as first_rx, b.avg_rx as last_rx,
                      b.avg_rx - a.avg_rx as delta
               FROM onu_daily a
               JOIN onu_daily b ON a.mac_address = b.mac_address
               WHERE a.day = (SELECT MIN(day) FROM onu_daily)
                 AND b.day = (SELECT MAX(day) FROM onu_daily)
                 AND a.avg_rx IS NOT NULL AND b.avg_rx IS NOT NULL
                 AND (b.avg_rx - a.avg_rx) < -0.3
               ORDER BY delta ASC
               LIMIT 10"""
        )).fetchall()
        for row in deg_rows:
            mac = row[0]
            cust = _fuzzy_find_customer(cust_idx, mac)
            degradation.append({
                "mac_address": mac,
                "first_rx": round(row[1], 2),
                "last_rx": round(row[2], 2),
                "delta": round(row[3], 2),
                "customer_name": _customer_name(cust),
            })
    except Exception:
        pass

    # --- Summary totals ---
    total_alarms = sum(row[1] for row in alarm_by_type)
    avg_network_uptime = None
    if uptime_sla:
        vals = [s["avg_uptime"] for s in uptime_sla if s["avg_uptime"] is not None]
        if vals:
            avg_network_uptime = round(sum(vals) / len(vals), 2)

    return {
        "summary": {
            "total_alarms": total_alarms,
            "days_analyzed": days,
            "avg_network_uptime": avg_network_uptime,
            "problem_onu_count": len([o for o in problem_onus if o["alarm_count"] >= 50]),
            "degrading_onu_count": len(degradation),
        },
        "alarm_by_type": [{"event_type": r[0], "count": r[1]} for r in alarm_by_type],
        "alarm_trend": [
            {"date": d, **counts} for d, counts in sorted(alarm_trend.items())
        ],
        "alarm_by_port": [{"pon_port": r[0], "count": r[1]} for r in alarm_by_port],
        "top_problem_onus": problem_onus,
        "uptime_sla": uptime_sla,
        "worst_uptime_onus": worst_uptime,
        "signal_degradation": degradation,
    }


def get_capacity_planning(db: Session) -> Dict[str, Any]:
    """
    Capacity planning: per-port utilization, signal distribution,
    growth trends from onu_daily, and expansion recommendations.
    """
    MAX_ONUS_PER_PORT = 64  # EPON standard: 64 ONUs per PON port

    # --- Per-port utilization ---
    port_rows = db.query(
        models.ONULatest.pon_port,
        models.ONULatest.olt_host,
        func.count(models.ONULatest.mac_address).label("total"),
        func.count(case((models.ONULatest.status == "online", 1))).label("online"),
        func.count(case((models.ONULatest.status != "online", 1))).label("offline"),
        func.avg(models.ONULatest.rx_power_dbm).label("avg_rx"),
        func.min(models.ONULatest.rx_power_dbm).label("worst_rx"),
        func.count(case((models.ONULatest.rx_power_dbm < -27, 1))).label("critical_count"),
        func.count(case((
            models.ONULatest.rx_power_dbm.between(-27, -24), 1
        ))).label("weak_count"),
        func.count(case((
            models.ONULatest.rx_power_dbm.between(-24, -20), 1
        ))).label("good_count"),
        func.count(case((models.ONULatest.rx_power_dbm > -20, 1))).label("excellent_count"),
    ).group_by(
        models.ONULatest.olt_host, models.ONULatest.pon_port,
    ).order_by(
        models.ONULatest.olt_host, models.ONULatest.pon_port,
    ).all()

    ports = []
    total_onus = 0
    total_capacity = 0
    alerts = []

    for row in port_rows:
        port_id = row.pon_port or "unknown"
        utilization = round((row.total / MAX_ONUS_PER_PORT) * 100, 1)
        total_onus += row.total
        total_capacity += MAX_ONUS_PER_PORT

        port_data = {
            "pon_port": port_id,
            "olt_host": row.olt_host or "",
            "total_onus": row.total,
            "max_capacity": MAX_ONUS_PER_PORT,
            "utilization_pct": utilization,
            "online": row.online,
            "offline": row.offline,
            "avg_rx": round(row.avg_rx, 2) if row.avg_rx else None,
            "worst_rx": round(row.worst_rx, 2) if row.worst_rx else None,
            "signal_distribution": {
                "excellent": row.excellent_count,
                "good": row.good_count,
                "weak": row.weak_count,
                "critical": row.critical_count,
            },
        }
        ports.append(port_data)

        # Generate alerts for overloaded ports
        if utilization >= 90:
            alerts.append({
                "type": "CRITICAL",
                "port": port_id,
                "olt_host": row.olt_host,
                "message": f"Port {port_id} at {utilization}% capacity ({row.total}/{MAX_ONUS_PER_PORT}). Immediate expansion needed.",
            })
        elif utilization >= 75:
            alerts.append({
                "type": "WARNING",
                "port": port_id,
                "olt_host": row.olt_host,
                "message": f"Port {port_id} at {utilization}% capacity ({row.total}/{MAX_ONUS_PER_PORT}). Plan expansion within 30 days.",
            })

        if row.critical_count >= 5:
            alerts.append({
                "type": "SIGNAL",
                "port": port_id,
                "olt_host": row.olt_host,
                "message": f"Port {port_id} has {row.critical_count} ONUs with critical signal. Check fiber infrastructure.",
            })

    # --- Network-wide signal distribution ---
    signal_dist = db.query(
        func.count(case((models.ONULatest.rx_power_dbm > -20, 1))).label("excellent"),
        func.count(case((models.ONULatest.rx_power_dbm.between(-24, -20), 1))).label("good"),
        func.count(case((models.ONULatest.rx_power_dbm.between(-27, -24), 1))).label("weak"),
        func.count(case((models.ONULatest.rx_power_dbm < -27, 1))).label("critical"),
        func.count(case((models.ONULatest.rx_power_dbm == None, 1))).label("no_signal"),
    ).first()

    # --- Growth trend from onu_daily (last 5 days) ---
    growth_trend = []
    try:
        daily_rows = db.execute(text(
            """SELECT day, COUNT(DISTINCT mac_address) as onu_count,
                      AVG(avg_rx) as avg_rx, AVG(online_pct) as avg_uptime
               FROM onu_daily
               GROUP BY day ORDER BY day"""
        )).fetchall()
        for row in daily_rows:
            growth_trend.append({
                "date": str(row[0]),
                "onu_count": row[1],
                "avg_rx": round(row[2], 2) if row[2] else None,
                "avg_uptime": round(row[3], 1) if row[3] else None,
            })
    except Exception:
        pass

    # --- OLT summary ---
    olt_hosts = db.query(
        models.ONULatest.olt_host,
        func.count(models.ONULatest.mac_address),
    ).group_by(models.ONULatest.olt_host).all()

    olts = []
    for olt_host, count in olt_hosts:
        port_count = len([p for p in ports if p["olt_host"] == olt_host])
        max_cap = port_count * MAX_ONUS_PER_PORT
        olts.append({
            "olt_host": olt_host,
            "total_onus": count,
            "total_ports": port_count,
            "max_capacity": max_cap,
            "utilization_pct": round((count / max_cap) * 100, 1) if max_cap else 0,
        })

    overall_utilization = round((total_onus / total_capacity) * 100, 1) if total_capacity else 0

    return {
        "summary": {
            "total_onus": total_onus,
            "total_capacity": total_capacity,
            "overall_utilization_pct": overall_utilization,
            "total_ports": len(ports),
            "total_olts": len(olts),
        },
        "ports": ports,
        "olts": olts,
        "signal_distribution": {
            "excellent": signal_dist.excellent if signal_dist else 0,
            "good": signal_dist.good if signal_dist else 0,
            "weak": signal_dist.weak if signal_dist else 0,
            "critical": signal_dist.critical if signal_dist else 0,
            "no_signal": signal_dist.no_signal if signal_dist else 0,
        },
        "growth_trend": growth_trend,
        "alerts": alerts,
    }


def get_customer_intelligence(
    db: Session,
    page: int = 1,
    page_size: int = 50,
    search: Optional[str] = None,
    filter_type: Optional[str] = None,
    sort_by: str = "health_score",
    sort_dir: str = "asc",
) -> Tuple[List[Dict[str, Any]], int]:
    """
    Customer Intelligence: unified view of every customer with their
    ONU signal data, billing info, and computed health score.

    filter_type options:
      - "offline"   — ONU currently offline
      - "critical"  — Rx < -27 dBm
      - "weak"      — Rx -24 to -27 dBm
      - "expiring"  — plan expires within 7 days
      - "expired"   — plan already expired
      - "no_onu"    — customer has no ONU link
    """
    # Load customer→ONU index for MAC offset matching
    cust_index = _load_customer_index(db)

    # Load all ONUs into a dict keyed by MAC
    all_onus = db.query(models.ONULatest).all()
    onu_by_mac: Dict[str, Any] = {o.mac_address.upper(): o for o in all_onus if o.mac_address}

    # Build customer MAC → ONU MAC mapping in one pass (O(N) where N = number of ONUs)
    customer_to_onu: Dict[str, str] = {}
    for onu_mac in onu_by_mac:
        c = _fuzzy_find_customer(cust_index, onu_mac)
        if c and c.mac_address:
            cust_upper = c.mac_address.upper()
            if cust_upper not in customer_to_onu:
                customer_to_onu[cust_upper] = onu_mac

    # Alarm counts per MAC in last 24h
    since_24h = datetime.now(timezone.utc) - timedelta(hours=24)
    alarm_rows = db.execute(text("""
        SELECT mac_address, COUNT(*) as cnt
        FROM alarm_events
        WHERE received_at >= :since
        GROUP BY mac_address
    """), {"since": since_24h}).fetchall()
    alarm_counts: Dict[str, int] = {row[0].upper(): row[1] for row in alarm_rows if row[0]}

    # Query all customers
    cust_query = db.query(models.Customer)

    if search:
        s = f"%{search}%"
        cust_query = cust_query.filter(
            (models.Customer.first_name.ilike(s)) |
            (models.Customer.last_name.ilike(s)) |
            (models.Customer.username.ilike(s)) |
            (models.Customer.phone.ilike(s)) |
            (models.Customer.mac_address.ilike(s))
        )

    customers = cust_query.all()

    # Build result list
    items = []
    now = datetime.now(timezone.utc)

    for cust in customers:
        cust_mac_upper = cust.mac_address.upper() if cust.mac_address else None

        # Find linked ONU via pre-built index (O(1) lookup)
        onu = None
        onu_mac_str = None
        if cust_mac_upper:
            if cust_mac_upper in onu_by_mac:
                onu = onu_by_mac[cust_mac_upper]
                onu_mac_str = cust_mac_upper
            elif cust_mac_upper in customer_to_onu:
                onu_mac_str = customer_to_onu[cust_mac_upper]
                onu = onu_by_mac.get(onu_mac_str)

        # Signal data
        rx = onu.rx_power_dbm if onu else None
        tx = onu.tx_power_dbm if onu else None
        temp = onu.temperature_c if onu else None
        onu_status = onu.status if onu else None
        polled_at = onu.polled_at if onu else None

        # Alarm count for this ONU
        alarm_count = alarm_counts.get(onu_mac_str, 0) if onu_mac_str else 0

        # Name
        parts = [(cust.first_name or '').strip(), (cust.last_name or '').strip()]
        name = ' '.join(p for p in parts if p and p.lower() != 'nan') or None

        # Health score
        health, factors = _compute_health(onu_status, rx, cust.expiry_date, alarm_count, cust.balance)

        # Apply filter
        if filter_type == "offline" and onu_status != "offline":
            continue
        if filter_type == "critical" and (rx is None or rx >= -27):
            continue
        if filter_type == "weak" and (rx is None or rx < -27 or rx >= -24):
            continue
        if filter_type == "expiring":
            if not cust.expiry_date:
                continue
            exp = cust.expiry_date.replace(tzinfo=timezone.utc) if cust.expiry_date.tzinfo is None else cust.expiry_date
            days_left = (exp - now).days
            if days_left < 0 or days_left > 7:
                continue
        if filter_type == "expired":
            if not cust.expiry_date:
                continue
            exp = cust.expiry_date.replace(tzinfo=timezone.utc) if cust.expiry_date.tzinfo is None else cust.expiry_date
            if (exp - now).days >= 0:
                continue
        if filter_type == "no_onu" and onu is not None:
            continue

        items.append({
            "username": cust.username,
            "name": name,
            "phone": cust.phone,
            "address": cust.railwire_address,
            "plan_name": cust.plan_name,
            "expiry_date": cust.expiry_date,
            "balance": cust.balance,
            "status": cust.status,
            "monthly_data_used_mb": cust.monthly_data_used_mb,
            "mac_address": cust.mac_address,
            "onu_mac": onu_mac_str,
            "onu_status": onu_status,
            "pon_port": onu.pon_port if onu else None,
            "olt_host": onu.olt_host if onu else None,
            "rx_power_dbm": round(rx, 2) if rx is not None else None,
            "tx_power_dbm": round(tx, 2) if tx is not None else None,
            "temperature_c": round(temp, 1) if temp is not None else None,
            "signal_level": _signal_level(rx),
            "health_score": health,
            "health_factors": factors,
            "last_seen_online": cust.last_seen_online,
            "polled_at": polled_at,
            "alarm_count_24h": alarm_count,
        })

    # Sort
    reverse = sort_dir == "desc"
    if sort_by == "health_score":
        items.sort(key=lambda x: x["health_score"], reverse=reverse)
    elif sort_by == "rx_power":
        items.sort(key=lambda x: (x["rx_power_dbm"] if x["rx_power_dbm"] is not None else 999), reverse=reverse)
    elif sort_by == "name":
        items.sort(key=lambda x: (x["name"] or "zzz").lower(), reverse=reverse)
    elif sort_by == "expiry":
        items.sort(key=lambda x: (x["expiry_date"] or datetime.min).isoformat(), reverse=reverse)

    total = len(items)

    # Paginate
    start = (page - 1) * page_size
    paged = items[start:start + page_size]

    return paged, total


# =============================================================================
# MANUAL ONU ↔ CUSTOMER LINKING
# =============================================================================

def link_onu_to_customer(
    db: Session,
    onu_mac: str,
    customer_username: str,
    binding_source: str = "tech_scan",
    changed_by: str = "ONU Link",
    reason: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Link an ONU to a customer.

    Writes authoritative network identity to onu_bindings. Legacy customer
    network columns remain read-only fallback and are not updated here.

    binding_source: 'tech_scan' (mobile scanner) | 'manual' (admin UI)
    confidence: always 'verified' for human-initiated links
    """
    from services.customer_service import diff_and_apply, write_customer_audit

    lookup = observed_lookup_values(onu_mac)
    identifiers = lookup["identifiers"] or {onu_mac.strip().upper()}
    mac_compact = lookup["mac"].replace(":", "") if lookup["mac"] else None
    filters = [func.upper(models.ONULatest.mac_address).in_(identifiers)]
    if mac_compact:
        filters.append(
            func.replace(
                func.replace(func.upper(models.ONULatest.mac_address), ":", ""),
                "-",
                "",
            ) == mac_compact
        )

    onu = db.query(models.ONULatest).filter(or_(*filters)).first()
    if not onu:
        return {"status": "error", "message": f"ONU {onu_mac} not found in live data"}

    customer = db.query(models.Customer).filter(
        models.Customer.username == customer_username
    ).first()
    if not customer:
        return {"status": "error", "message": f"Customer {customer_username} not found"}

    identity = build_binding_identity(onu_identifier=onu.mac_address)
    existing_other = find_active_binding_for_observed_onu(
        db,
        onu.mac_address,
        olt_host=onu.olt_host,
        pon_port=onu.pon_port,
        onu_index=onu.onu_index,
    )
    if existing_other and existing_other.customer_id != customer_username:
        return {
            "status": "error",
            "message": (
                f"ONU {onu.mac_address} is already actively bound to "
                f"{existing_other.customer_id}. Resolve duplicate before relinking."
            ),
        }

    # Keep physical serial evidence on Customer, but do not mirror MAC/OLT
    # placement into legacy columns. ONUBinding is authoritative.
    patch = {}
    if identity["primary_identifier_type"] == "serial" and identity["serial_number"]:
        patch["ont_serial_number"] = identity["serial_number"]
    if patch:
        changes = diff_and_apply(customer, patch)
        write_customer_audit(
            db,
            customer_id=customer_username,
            changes=changes,
            changed_by=f"ONU Link ({binding_source})",
            action="ONU_LINK",
        )

    # ── onu_bindings: upsert the authoritative binding ──
    # tech_scan and manual are 'verified' — higher than railwire_scraped.
    # Remove any existing railwire_scraped binding for this customer before inserting
    # our higher-confidence one, so there's no confusing duplicate.
    existing_binding = db.query(models.ONUBinding).filter(
        models.ONUBinding.customer_id == customer_username,
    ).order_by(
        # Prefer existing verified bindings (keep them, just update last_seen)
        models.ONUBinding.first_seen.asc()
    ).first()

    binding_fields = [
        "onu_identifier",
        "onu_type",
        "primary_identifier_type",
        "serial_number",
        "mac_address",
        "olt_host",
        "pon_port",
        "onu_index",
        "binding_source",
        "confidence",
        "is_active",
    ]
    old_binding_snapshot = {
        field: getattr(existing_binding, field, None)
        for field in binding_fields
    } if existing_binding else {field: None for field in binding_fields}

    binding_ref: models.ONUBinding
    if existing_binding and existing_binding.binding_source in ("tech_scan", "manual", "field_scan", "admin_verified", "pg_survey"):
        # Update existing verified binding in place
        existing_binding.onu_identifier = identity["onu_identifier"] or onu.mac_address
        existing_binding.onu_type = identity["onu_type"] or existing_binding.onu_type
        existing_binding.primary_identifier_type = identity["primary_identifier_type"]
        existing_binding.serial_number = identity["serial_number"]
        existing_binding.mac_address = identity["mac_address"]
        existing_binding.olt_host = onu.olt_host
        existing_binding.pon_port = onu.pon_port
        existing_binding.onu_index = onu.onu_index
        existing_binding.last_seen = func.now()
        existing_binding.verified_at = func.now()
        existing_binding.is_active = True
        existing_binding.deactivated_at = None
        existing_binding.deactivated_reason = None
        existing_binding.binding_source = binding_source
        existing_binding.confidence = "verified"
        if reason:
            existing_binding.notes = reason
        binding_ref = existing_binding
    else:
        # Remove any lower-confidence binding and insert fresh verified one
        if existing_binding:
            db.delete(existing_binding)
        binding_ref = models.ONUBinding(
            customer_id=customer_username,
            onu_identifier=identity["onu_identifier"] or onu.mac_address,
            onu_type=identity["onu_type"] or "epon",
            primary_identifier_type=identity["primary_identifier_type"],
            serial_number=identity["serial_number"],
            mac_address=identity["mac_address"],
            olt_host=onu.olt_host,
            pon_port=onu.pon_port,
            onu_index=onu.onu_index,
            binding_source=binding_source,
            confidence="verified",
            verified_at=func.now(),
            is_active=True,
            notes=reason,
        )
        db.add(binding_ref)

    binding_changes = []
    for field in binding_fields:
        old_value = old_binding_snapshot.get(field)
        new_value = getattr(binding_ref, field, None)
        if old_value != new_value:
            binding_changes.append({
                "field_name": f"onu_binding.{field}",
                "old_value": old_value,
                "new_value": new_value,
            })
    if reason:
        binding_changes.append({
            "field_name": "onu_binding.review_note",
            "old_value": None,
            "new_value": reason,
        })
    if binding_changes:
        write_customer_audit(
            db,
            customer_id=customer_username,
            changes=binding_changes,
            changed_by=changed_by,
            action="ONU_LINK",
        )

    db.commit()

    return {
        "status": "ok",
        "message": f"ONU {onu.mac_address} linked to {customer_username}",
        "onu_mac": onu.mac_address,
        "customer": customer_username,
        "pon_port": onu.pon_port,
        "onu_index": onu.onu_index,
        "binding_source": binding_source,
    }


def unlink_onu(db: Session, onu_mac: str) -> Dict[str, Any]:
    """Deactivate the active ONU binding and clear stale customer network fields."""
    from services.customer_service import write_customer_audit

    onu = db.query(models.ONULatest).filter(
        func.upper(models.ONULatest.mac_address) == onu_mac.upper()
    ).first()
    if not onu:
        return {"status": "error", "message": f"ONU {onu_mac} not found"}

    binding = find_active_binding_for_observed_onu(
        db,
        onu.mac_address,
        olt_host=onu.olt_host,
        pon_port=onu.pon_port,
        onu_index=onu.onu_index,
    )
    customer = None
    if binding:
        customer = db.query(models.Customer).filter(
            models.Customer.username == binding.customer_id
        ).first()
    if customer is None:
        customer = db.query(models.Customer).filter(
            models.Customer.olt_host == onu.olt_host,
            models.Customer.pon_port == onu.pon_port,
            models.Customer.onu_index == onu.onu_index,
        ).first()

    if not customer:
        return {"status": "error", "message": "No customer linked to this ONU"}

    now = datetime.now(timezone.utc)
    changes = []
    clear_fields = {
        "olt_host": None,
        "pon_port": None,
        "onu_index": None,
    }
    if binding and binding.primary_identifier_type == "mac" and customer.mac_address == binding.mac_address:
        clear_fields["mac_address"] = None
    elif not binding and customer.mac_address and customer.mac_address.upper() == onu.mac_address.upper():
        clear_fields["mac_address"] = None
    if binding and binding.primary_identifier_type == "serial" and customer.ont_serial_number == binding.serial_number:
        clear_fields["ont_serial_number"] = None

    for field, new_value in clear_fields.items():
        old_value = getattr(customer, field, None)
        if old_value != new_value:
            changes.append({"field_name": field, "old_value": old_value, "new_value": new_value})
            setattr(customer, field, new_value)

    if binding:
        binding.is_active = False
        binding.deactivated_at = now
        binding.deactivated_reason = "manual_unlink"
        binding.last_seen = now

    if changes:
        write_customer_audit(
            db,
            customer_id=customer.username,
            changes=changes,
            changed_by="ONU Unlink",
            action="ONU_UNLINK",
        )

    db.commit()

    return {"status": "ok", "message": f"Unlinked ONU {onu_mac} from {customer.username}"}


def search_customers_for_linking(db: Session, query: str, limit: int = 10) -> Tuple[List[Dict], int]:
    """Lightweight customer search for the ONU linking UI."""
    q = query.strip()
    if not q or len(q) < 2:
        return [], 0

    pattern = f"%{q}%"
    customers = db.query(models.Customer).filter(
        (models.Customer.first_name.ilike(pattern)) |
        (models.Customer.last_name.ilike(pattern)) |
        (models.Customer.phone.ilike(pattern)) |
        (models.Customer.username.ilike(pattern)) |
        (models.Customer.railwire_address.ilike(pattern))
    ).limit(limit).all()

    results = []
    for c in customers:
        name_parts = [(c.first_name or '').strip(), (c.last_name or '').strip()]
        name = ' '.join(p for p in name_parts if p)
        results.append({
            "username": c.username,
            "name": name or None,
            "phone": c.phone,
            "address": (c.railwire_address or '')[:80],
            "plan_name": c.plan_name,
            "has_onu_link": c.olt_host is not None,
        })

    return results, len(results)


def _onu_for_binding_identity(db: Session, binding: models.ONUBinding) -> Optional[models.ONULatest]:
    identifiers: List[str] = []

    def add(value: Any, *, serial: bool = False) -> None:
        if value is None:
            return
        text_value = str(value).strip()
        if not text_value:
            return
        identifiers.append(text_value.upper())
        if serial and not text_value.upper().startswith("SN:"):
            identifiers.append(f"SN:{text_value.upper()}")

    add(binding.onu_identifier, serial=(binding.primary_identifier_type == "serial" or binding.onu_type == "gpon"))
    add(binding.serial_number, serial=True)
    add(binding.mac_address)
    identifiers = sorted({value for value in identifiers if value})
    if not identifiers:
        return None

    onu = db.query(models.ONULatest).filter(
        func.upper(models.ONULatest.mac_address).in_(identifiers)
    ).order_by(models.ONULatest.polled_at.desc()).first()
    if onu and (
        binding.olt_host != onu.olt_host
        or binding.pon_port != onu.pon_port
        or binding.onu_index != onu.onu_index
    ):
        binding.olt_host = onu.olt_host
        binding.pon_port = onu.pon_port
        binding.onu_index = onu.onu_index
        binding.last_seen = datetime.now(timezone.utc)
        db.commit()
    return onu


def _onu_for_customer_mac_exact(db: Session, customer: models.Customer) -> Optional[models.ONULatest]:
    """Return the live OLT row whose observed MAC exactly equals Railwire MAC."""
    mac = normalize_mac(customer.mac_address)
    if not mac:
        return None
    return db.query(models.ONULatest).filter(
        func.upper(models.ONULatest.mac_address) == mac.upper()
    ).order_by(models.ONULatest.polled_at.desc()).first()


def _onu_for_customer(db: Session, customer: models.Customer) -> Optional[models.ONULatest]:
    binding = db.query(models.ONUBinding).filter(
        models.ONUBinding.customer_id == customer.username,
        models.ONUBinding.is_active.is_(True),
    ).order_by(models.ONUBinding.verified_at.desc().nullslast()).first()
    if binding:
        # A verified survey/admin binding is the system-of-record for physical
        # identity. Railwire/account MAC can appear as a review candidate, but
        # must not replace the primary ONU row unless an admin promotes it.
        return _onu_for_binding_identity(db, binding)
    return None


def _active_binding_for_customer(db: Session, customer_id: str) -> Optional[models.ONUBinding]:
    return db.query(models.ONUBinding).filter(
        models.ONUBinding.customer_id == customer_id,
        models.ONUBinding.is_active.is_(True),
    ).order_by(
        models.ONUBinding.verified_at.desc().nullslast(),
        models.ONUBinding.last_seen.desc().nullslast(),
    ).first()


def _valid_coord(lat: Any, lng: Any) -> bool:
    try:
        return abs(float(lat)) > 0.1 and abs(float(lng)) > 0.1
    except (TypeError, ValueError):
        return False


def _safe_round(value: Any, digits: int = 2) -> Optional[float]:
    try:
        return round(float(value), digits) if value is not None else None
    except (TypeError, ValueError):
        return None


def _customer_identity_values(
    customer: models.Customer,
    binding: Optional[models.ONUBinding],
    onu: Optional[models.ONULatest],
) -> List[str]:
    values = set()

    def add(value: Any, *, serial: bool = False) -> None:
        if value is None:
            return
        text_value = str(value).strip()
        if not text_value:
            return
        values.add(text_value)
        values.add(text_value.upper())
        if serial and not text_value.upper().startswith("SN:"):
            values.add(f"SN:{text_value}")
            values.add(f"SN:{text_value.upper()}")

    if binding:
        add(binding.onu_identifier, serial=(binding.primary_identifier_type == "serial" or binding.onu_type == "gpon"))
        add(binding.serial_number, serial=True)
        add(binding.mac_address)
    if onu:
        add(onu.mac_address, serial=onu.mac_address.upper().startswith("SN:"))

    return sorted(values)


def _onu_identity_payload(row: models.ONULatest, now: datetime, problem_hosts: Set[str]) -> Dict[str, Any]:
    age_seconds = _age_seconds(now, row.polled_at)
    stale = bool(age_seconds is None or age_seconds > 600 or row.olt_host in problem_hosts)
    return {
        "mac_address": row.mac_address,
        "olt_host": row.olt_host,
        "pon_port": row.pon_port,
        "onu_index": row.onu_index,
        "status": row.status,
        "rx_power_dbm": _safe_round(row.rx_power_dbm),
        "polled_at": row.polled_at,
        "age_seconds": age_seconds,
        "stale": stale,
    }


def _is_fresh_onu(row: Optional[models.ONULatest], now: datetime, problem_hosts: Set[str]) -> bool:
    if not row:
        return False
    age_seconds = _age_seconds(now, row.polled_at)
    return bool(age_seconds is not None and age_seconds <= 600 and row.olt_host not in problem_hosts)


def _normal_identity(value: Any) -> Optional[str]:
    if value is None:
        return None
    text_value = str(value).strip()
    return text_value.upper() if text_value else None


def _ticket_is_open(ticket: models.Ticket) -> bool:
    status = (ticket.status or "").strip().lower()
    return status not in {"closed", "resolved", "done", "cancelled"}


def get_customer_dna(db: Session, username: str) -> Optional[Dict[str, Any]]:
    """Full NOC decision profile for one customer."""
    customer = db.query(models.Customer).filter(models.Customer.username == username).first()
    if not customer:
        return None

    now = datetime.now(timezone.utc)
    since_24h = now - timedelta(hours=24)
    binding = _active_binding_for_customer(db, customer.username)
    onu = _onu_for_customer(db, customer)
    identities = _customer_identity_values(customer, binding, onu)
    identity_upper = [value.upper() for value in identities]

    alarm_filter = None
    if identity_upper:
        alarm_filter = func.upper(models.AlarmEvent.mac_address).in_(identity_upper)

    alarm_count_24h = 0
    alarms: List[Dict[str, Any]] = []
    if alarm_filter is not None:
        alarm_count_24h = db.query(func.count(models.AlarmEvent.id)).filter(
            alarm_filter,
            models.AlarmEvent.received_at >= since_24h,
        ).scalar() or 0
        latest_alarms = db.query(models.AlarmEvent).filter(
            alarm_filter,
        ).order_by(models.AlarmEvent.received_at.desc()).limit(10).all()
        alarms = [
            {
                "id": alarm.id,
                "mac_address": alarm.mac_address,
                "event_type": alarm.event_type,
                "status": alarm.status,
                "olt_host": alarm.olt_host,
                "pon_port": alarm.pon_port,
                "onu_index": alarm.onu_index,
                "received_at": alarm.received_at,
                "resolved_at": alarm.resolved_at,
                "occurrence_count": alarm.occurrence_count,
            }
            for alarm in latest_alarms
        ]

    latest_tickets = db.query(models.Ticket).filter(
        models.Ticket.customer_id == customer.username,
    ).order_by(models.Ticket.created_at.desc().nullslast()).limit(10).all()
    open_ticket_count = sum(1 for ticket in latest_tickets if _ticket_is_open(ticket))
    tickets = [
        {
            "id": ticket.id,
            "issue_type": ticket.issue_type,
            "priority": ticket.priority,
            "status": ticket.status,
            "description": ticket.description,
            "assigned_tech": ticket.assigned_tech,
            "created_at": ticket.created_at,
            "assigned_at": ticket.assigned_at,
            "started_at": ticket.started_at,
            "resolved_at": ticket.resolved_at,
            "closed_at": ticket.closed_at,
        }
        for ticket in latest_tickets
    ]

    assignment = db.query(models.CollectionAssignment).filter(
        models.CollectionAssignment.customer_id == customer.username,
    ).order_by(
        models.CollectionAssignment.completed_at.desc().nullslast(),
        models.CollectionAssignment.assigned_at.desc().nullslast(),
    ).first()
    survey = None
    if assignment:
        collector = db.query(models.Technician).filter(
            models.Technician.id == assignment.collector_id,
        ).first()
        survey = {
            "assignment_id": assignment.id,
            "campaign_id": assignment.campaign_id,
            "collector_id": assignment.collector_id,
            "collector_name": collector.full_name if collector else None,
            "status": assignment.status,
            "skip_reason": assignment.skip_reason,
            "attempts": assignment.attempts,
            "assigned_at": assignment.assigned_at,
            "completed_at": assignment.completed_at,
            "last_surveyed_at": customer.last_surveyed_at,
        }

    # Bandwidth from ONU snapshots (bytes delta → Mbps)
    olt_capability = serialize_olt_capability(onu.olt_host if onu else None)
    bandwidth = _bandwidth_unavailable(
        "No live ONU is linked to this customer yet.",
        source_status="unavailable",
    )
    if onu:
        cap = get_olt_capability(onu.olt_host)
        if not cap.has_customer_bandwidth:
            bandwidth = _bandwidth_unavailable(cap.customer_bandwidth_reason)
        else:
            bw_rows = db.execute(text("""
                SELECT rx_bytes_delta, tx_bytes_delta, polled_at
                FROM onu_snapshots
                WHERE mac_address = :mac
                  AND olt_host = :olt_host
                  AND pon_port = :pon_port
                  AND onu_index = :onu_index
                  AND rx_bytes_delta IS NOT NULL
                  AND rx_bytes_delta > 0
                ORDER BY polled_at DESC LIMIT 2
            """), {
                "mac": onu.mac_address,
                "olt_host": onu.olt_host,
                "pon_port": onu.pon_port,
                "onu_index": onu.onu_index,
            }).fetchall()
            if len(bw_rows) == 2 and bw_rows[0][0]:
                bw_row = bw_rows[0]
                poll_interval_s = (bw_rows[0][2] - bw_rows[1][2]).total_seconds()
                if 20 < poll_interval_s < 600:
                    bandwidth = {
                        "rx_mbps": round(bw_row[0] * 8 / poll_interval_s / 1_000_000, 3),
                        "tx_mbps": round((bw_row[1] or 0) * 8 / poll_interval_s / 1_000_000, 3),
                        "sampled_at": bw_row[2].isoformat() if bw_row[2] else None,
                        "supported": True,
                        "source_status": "live",
                        "reason": cap.customer_bandwidth_reason,
                    }
                else:
                    bandwidth = _bandwidth_unavailable(
                        "OLT traffic samples exist, but their interval is outside the trusted 20-600 second window.",
                        source_status="untrusted",
                    )
            else:
                bandwidth = {
                    "rx_mbps": None,
                    "tx_mbps": None,
                    "sampled_at": None,
                    "supported": True,
                    "source_status": "no_sample",
                    "reason": "This OLT supports customer traffic counters, but two trusted samples are not available yet.",
                }

    # Prediction intelligence (try all identity values)
    prediction = None
    for ident in identities:
        pred_row = db.execute(text("""
            SELECT health_score, fiber_risk, churn_risk, recommended_action,
                   rx_slope_7d, rx_avg_7d, last_computed
            FROM predictions WHERE mac_address = :mac
        """), {"mac": ident}).fetchone()
        if pred_row:
            prediction = {
                "health_score": pred_row[0],
                "fiber_risk": pred_row[1],
                "churn_risk": pred_row[2],
                "recommended_action": pred_row[3],
                "rx_slope_7d": pred_row[4],
                "rx_avg_7d": pred_row[5],
                "last_computed": pred_row[6].isoformat() if pred_row[6] else None,
            }
            break

    room_filters = [models.PGRoom.username == customer.username]
    if customer.mac_address:
        room_filters.append(func.upper(models.PGRoom.mac_address) == customer.mac_address.upper())
    if customer.ont_serial_number:
        room_filters.append(func.upper(models.PGRoom.ont_serial) == customer.ont_serial_number.upper())
    room = db.query(models.PGRoom).filter(or_(*room_filters)).first()
    pg = None
    if room:
        building = room.building
        floor = room.floor
        router_group = room.router_group
        pg = {
            "building_id": building.id if building else room.building_id,
            "building_name": building.name if building else None,
            "building_type": building.pg_type if building else None,
            "building_address": building.address if building else None,
            "building_gps_lat": building.gps_lat if building else None,
            "building_gps_lng": building.gps_lng if building else None,
            "floor_id": floor.id if floor else room.floor_id,
            "floor_number": floor.floor_number if floor else None,
            "room_id": room.id,
            "room_number": room.room_number,
            "room_status": room.status,
            "connection_type": room.connection_type,
            "router_group_id": room.router_group_id,
            "router_group_name": router_group.group_name if router_group else None,
            "room_ont_serial": room.ont_serial,
            "room_mac_address": room.mac_address,
            "room_ont_model": room.ont_model,
            "tech_note": room.tech_note,
            "collected_at": room.collected_at,
        }

    rx = onu.rx_power_dbm if onu else None
    onu_status = onu.status if onu else None
    onu_age_seconds = _age_seconds(now, onu.polled_at) if onu else None
    onu_stale = bool(onu_age_seconds is None or onu_age_seconds > 600) if onu else True
    freshness = _olt_freshness_state(db, now)
    problem_hosts = set(
        freshness.get("stale_hosts", [])
        + freshness.get("missing_hosts", [])
        + freshness.get("untrusted_hosts", [])
    )
    if onu and onu.olt_host in problem_hosts:
        onu_stale = True
    if onu and onu_stale and bandwidth.get("supported"):
        bandwidth = _bandwidth_unavailable(
            "OLT traffic counters are stale for this ONU. Old byte deltas are hidden to avoid false live Mbps.",
            source_status="stale",
        )

    identity_conflicts: List[Dict[str, Any]] = []
    binding_identities = {
        value for value in [
            _normal_identity(binding.onu_identifier if binding else None),
            _normal_identity(binding.mac_address if binding else None),
            _normal_identity(binding.serial_number if binding else None),
        ] if value
    }

    def add_conflict(kind: str, severity: str, message: str, candidate: Optional[models.ONULatest] = None) -> None:
        payload = {
            "kind": kind,
            "severity": severity,
            "message": message,
        }
        if candidate:
            payload["onu"] = _onu_identity_payload(candidate, now, problem_hosts)
        identity_conflicts.append(payload)

    if binding:
        if onu is None:
            add_conflict(
                "binding_not_seen",
                "review",
                "Verified binding identity is not present in the live OLT table.",
            )
        elif onu_stale:
            add_conflict(
                "binding_stale",
                "review",
                "Verified binding exists only as last-known OLT data; live OLT did not refresh this identity.",
                onu,
            )

        if binding.olt_host and binding.pon_port and binding.onu_index is not None:
            live_at_binding_slot = db.query(models.ONULatest).filter(
                models.ONULatest.olt_host == binding.olt_host,
                models.ONULatest.pon_port == binding.pon_port,
                models.ONULatest.onu_index == binding.onu_index,
            ).order_by(models.ONULatest.polled_at.desc()).first()
            if (
                _is_fresh_onu(live_at_binding_slot, now, problem_hosts)
                and _normal_identity(live_at_binding_slot.mac_address) not in binding_identities
            ):
                verified_identity_live_elsewhere = bool(
                    onu
                    and _is_fresh_onu(onu, now, problem_hosts)
                    and _normal_identity(onu.mac_address) in binding_identities
                    and (
                        onu.olt_host != binding.olt_host
                        or onu.pon_port != binding.pon_port
                        or onu.onu_index != binding.onu_index
                    )
                )
                if verified_identity_live_elsewhere:
                    add_conflict(
                        "binding_position_changed",
                        "review",
                        "Verified ONT identity is live at a different OLT index; saved binding position is stale.",
                        live_at_binding_slot,
                    )
                else:
                    add_conflict(
                        "binding_slot_changed",
                        "critical",
                        "The verified binding's OLT slot is currently occupied by a different live ONU identity.",
                        live_at_binding_slot,
                    )

        legacy_mac = _normal_identity(customer.mac_address)
        if legacy_mac and legacy_mac not in binding_identities:
            legacy_live = db.query(models.ONULatest).filter(
                func.upper(models.ONULatest.mac_address) == legacy_mac,
            ).order_by(models.ONULatest.polled_at.desc()).first()
            if _is_fresh_onu(legacy_live, now, problem_hosts):
                add_conflict(
                    "legacy_mac_live",
                    "review",
                    "Railwire/account MAC is live in OLT SNMP but differs from the verified survey/sticker ONT identity. Keep both separate unless an admin confirms the physical binding changed.",
                    legacy_live,
                )
    else:
        add_conflict(
            "missing_trusted_binding",
            "review",
            "No verified ONT binding exists. Railwire/account MAC can help discovery, but customer network status is blocked until ONT MAC or serial is verified.",
        )
        railwire_live = _onu_for_customer_mac_exact(db, customer)
        if _is_fresh_onu(railwire_live, now, problem_hosts):
            add_conflict(
                "railwire_mac_discovery_clue",
                "review",
                "Railwire/account MAC is visible in OLT data. Treat it as a discovery clue only; create or verify an ONT binding before using it for customer status.",
                railwire_live,
            )

    health_score, health_factors = _compute_health(
        onu_status,
        rx,
        customer.expiry_date,
        alarm_count_24h,
        customer.balance,
    )

    gps_lat = customer.gps_lat if _valid_coord(customer.gps_lat, customer.gps_lng) else None
    gps_lng = customer.gps_lng if _valid_coord(customer.gps_lat, customer.gps_lng) else None
    geo_lat = customer.geo_lat if _valid_coord(customer.geo_lat, customer.geo_long) else None
    geo_long = customer.geo_long if _valid_coord(customer.geo_lat, customer.geo_long) else None
    pg_building_lat = pg.get("building_gps_lat") if pg else None
    pg_building_lng = pg.get("building_gps_lng") if pg else None
    pg_building_has_location = _valid_coord(pg_building_lat, pg_building_lng)
    if pg_building_has_location:
        map_lat = pg_building_lat
        map_lng = pg_building_lng
        location_source = "pg_building"
    elif gps_lat is not None:
        map_lat = gps_lat
        map_lng = gps_lng
        location_source = "field_gps"
    elif geo_lat is not None:
        map_lat = geo_lat
        map_lng = geo_long
        location_source = "legacy_geo"
    else:
        map_lat = None
        map_lng = None
        location_source = None

    exp = customer.expiry_date
    if exp and exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)

    health_flags = {
        "offline": onu_status == "offline" and not onu_stale,
        "critical_signal": rx is not None and rx < -27 and not onu_stale,
        "weak_signal": rx is not None and -27 <= rx < -24 and not onu_stale,
        "expired": bool(exp and exp < now),
        "no_live_onu": onu is None,
        "stale_live_onu": onu_stale,
        "binding_conflict": bool(identity_conflicts),
        "no_trusted_binding": binding is None,
        "missing_gps": map_lat is None or map_lng is None,
        "missing_sticker": not bool(customer.sticker_photo_url or (binding and binding.sticker_photo_url)),
        "open_ticket": open_ticket_count > 0,
        "has_pg_room": pg is not None,
    }

    customer_url = f"/customers/{customer.username}"
    onu_url = f"/onus/{onu.mac_address}" if onu else None
    map_url = None
    if onu:
        map_url = f"/map?mac={onu.mac_address}"
    elif map_lat is not None and map_lng is not None:
        map_url = f"/map?customer={customer.username}"
    pg_url = f"/pg?building={pg['building_id']}" if pg and pg.get("building_id") else None
    provenance = [
        {
            "field_name": row.field_name,
            "source": row.source,
            "source_rank": row.source_rank,
            "writer": row.writer,
            "evidence_ref": row.evidence_ref,
            "updated_at": row.updated_at,
            "verified_at": row.verified_at,
            "notes": row.notes,
        }
        for row in db.query(models.CustomerFieldProvenance)
        .filter(models.CustomerFieldProvenance.customer_id == customer.username)
        .order_by(models.CustomerFieldProvenance.field_name.asc())
        .all()
    ]
    audit_log = [
        {
            "id": row.id,
            "action": row.action,
            "field_name": row.field_name,
            "old_value": row.old_value,
            "new_value": row.new_value,
            "changed_by": row.changed_by,
            "changed_at": row.changed_at,
        }
        for row in db.query(models.CustomerAuditLog)
        .filter(models.CustomerAuditLog.customer_id == customer.username)
        .order_by(models.CustomerAuditLog.changed_at.desc(), models.CustomerAuditLog.id.desc())
        .limit(20)
        .all()
    ]

    return {
        "customer": {
            "username": customer.username,
            "id": customer.id,
            "name": _customer_name(customer),
            "first_name": customer.first_name,
            "last_name": customer.last_name,
            "phone": customer.phone,
            "alt_phone": customer.alt_phone,
            "email": customer.email,
            "railwire_address": customer.railwire_address,
            "rico_address": customer.rico_address,
            "notes": customer.notes,
            "plan_name": customer.plan_name,
            "expiry_date": customer.expiry_date,
            "status": customer.status,
            "balance": customer.balance,
            "framed_ip": customer.framed_ip,
            "monthly_data_used_mb": customer.monthly_data_used_mb,
            "connection_status": customer.connection_status,
            "last_seen_online": customer.last_seen_online,
            "mac_address": customer.mac_address,
            "device_setup": getattr(customer, "device_setup", None),
            "ont_serial_number": customer.ont_serial_number,
            "ont_model": customer.ont_model,
            "ont_sticker_data": getattr(customer, "ont_sticker_data", None),
            "router_mac_address": getattr(customer, "router_mac_address", None),
            "router_model": customer.router_model,
            "router_serial": customer.router_serial,
            "router_sticker_data": getattr(customer, "router_sticker_data", None),
            "olt_host": customer.olt_host,
            "pon_port": customer.pon_port,
            "onu_index": customer.onu_index,
            "gps_lat": gps_lat,
            "gps_lng": gps_lng,
            "gps_accuracy_m": customer.gps_accuracy_m,
            "geo_lat": geo_lat,
            "geo_long": geo_long,
            "map_lat": map_lat,
            "map_lng": map_lng,
            "location_source": location_source,
            "install_photo_url": customer.install_photo_url,
            "sticker_photo_url": customer.sticker_photo_url,
            "router_sticker_photo_url": customer.router_sticker_photo_url,
            "last_surveyed_at": customer.last_surveyed_at,
            "pole_group_id": customer.pg_id,
            "pole_group_name": customer.pg_name,
            "created_at": customer.created_at,
            "last_updated": customer.last_updated,
        },
        "binding": {
            "id": binding.id,
            "onu_identifier": binding.onu_identifier,
            "onu_type": binding.onu_type,
            "primary_identifier_type": binding.primary_identifier_type,
            "serial_number": binding.serial_number,
            "mac_address": binding.mac_address,
            "olt_host": binding.olt_host,
            "pon_port": binding.pon_port,
            "onu_index": binding.onu_index,
            "binding_source": binding.binding_source,
            "confidence": binding.confidence,
            "first_seen": binding.first_seen,
            "last_seen": binding.last_seen,
            "verified_at": binding.verified_at,
            "sticker_photo_url": binding.sticker_photo_url,
            "notes": binding.notes,
        } if binding else None,
        "onu": {
            "mac_address": onu.mac_address,
            "olt_host": onu.olt_host,
            "pon_port": onu.pon_port,
            "onu_index": onu.onu_index,
            "status": onu.status,
            "rx_power_dbm": _safe_round(onu.rx_power_dbm),
            "tx_power_dbm": _safe_round(onu.tx_power_dbm),
            "temperature_c": _safe_round(onu.temperature_c, 1),
            "voltage_mv": onu.voltage_mv,
            "dying_gasp": onu.dying_gasp,
            "polled_at": onu.polled_at,
            "age_seconds": onu_age_seconds,
            "stale": onu_stale,
            "vendor_id": onu.vendor_id,
            "model_id": onu.model_id,
            "hw_version": onu.hw_version,
            "sw_version": onu.sw_version,
            "signal_level": _signal_level(onu.rx_power_dbm),
        } if onu else None,
        "identity_conflicts": identity_conflicts,
        "health": {
            "score": health_score,
            "factors": health_factors,
            "flags": health_flags,
            "alarm_count_24h": alarm_count_24h,
            "open_ticket_count": open_ticket_count,
            "identity_values": identities,
            "decision": "review_identity" if (identity_conflicts or binding is None) else (
                "dispatch" if health_flags["offline"] or health_flags["critical_signal"] or health_flags["open_ticket"] else "monitor"
            ),
        },
        "alarms": alarms,
        "tickets": tickets,
        "survey": survey,
        "pg": pg,
        "provenance": provenance,
        "audit_log": audit_log,
        "olt_capability": olt_capability,
        "bandwidth": bandwidth,
        "prediction": prediction,
        "links": {
            "customer": customer_url,
            "onu": onu_url,
            "map": map_url,
            "pg": pg_url,
        },
    }


def _mac_search_fragment(value: str) -> Optional[str]:
    """Return a colon/dash-insensitive partial MAC search fragment."""
    compact = re.sub(r"[^0-9A-Fa-f]", "", value or "").upper()
    if len(compact) < 4:
        return None
    return compact


def _search_norm(value: Any) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", str(value or "").lower())).strip()


def global_search(db: Session, query: str, limit: int = 8) -> Dict[str, Any]:
    """Unified NOC search across customers and live ONU identities."""
    q = query.strip()
    if len(q) < 2:
        return {"results": [], "total": 0}

    pattern = f"%{q}%"
    q_norm = _search_norm(q)
    mac_fragment = _mac_search_fragment(q)
    mac_pattern = f"%{mac_fragment}%" if mac_fragment else None
    results: List[Dict[str, Any]] = []
    seen_keys: Set[str] = set()
    full_name_expr = func.concat(
        func.coalesce(models.Customer.first_name, ""),
        " ",
        func.coalesce(models.Customer.last_name, ""),
    )

    customer_filters = [
        models.Customer.username.ilike(pattern),
        models.Customer.first_name.ilike(pattern),
        models.Customer.last_name.ilike(pattern),
        full_name_expr.ilike(pattern),
        models.Customer.phone.ilike(pattern),
        models.Customer.railwire_address.ilike(pattern),
        models.Customer.mac_address.ilike(pattern),
        models.Customer.ont_serial_number.ilike(pattern),
    ]
    if mac_pattern:
        customer_filters.append(
            func.replace(
                func.replace(func.upper(models.Customer.mac_address), ":", ""),
                "-",
                "",
            ).ilike(mac_pattern)
        )
    customers = db.query(models.Customer).filter(or_(*customer_filters)).limit(max(limit * 4, 20)).all()

    def customer_rank(customer: models.Customer) -> Tuple[int, str]:
        name = _search_norm(_customer_name(customer) or "")
        username = _search_norm(customer.username)
        phone = _search_norm(customer.phone)
        address = _search_norm(customer.railwire_address)
        if name == q_norm:
            rank = 0
        elif name.startswith(q_norm):
            rank = 1
        elif q_norm in name:
            rank = 2
        elif username == q_norm:
            rank = 3
        elif username.startswith(q_norm):
            rank = 4
        elif phone.startswith(q_norm):
            rank = 5
        elif q_norm in address:
            rank = 7
        else:
            rank = 9
        return (rank, name or username)

    ranked_customers = [(customer_rank(customer), customer) for customer in customers]
    name_like_query = bool(re.search(r"[A-Za-z]", q)) and len(q_norm.split()) > 1
    max_rank = 5 if name_like_query else 9
    customers = [
        customer
        for rank, customer in sorted(ranked_customers, key=lambda item: item[0])
        if rank[0] <= max_rank
    ][:limit]

    for customer in customers:
        name = _customer_name(customer) or customer.username
        onu = _onu_for_customer(db, customer)
        target_url = f"/customers/{customer.username}"
        key = f"customer:{customer.username}"
        seen_keys.add(key)
        results.append({
            "type": "customer",
            "label": name,
            "subtitle": " | ".join(v for v in [customer.username, customer.phone, customer.plan_name] if v),
            "target_url": target_url,
            "customer_username": customer.username,
            "mac_address": onu.mac_address if onu else customer.mac_address,
            "status": onu.status if onu else customer.status,
            "match_source": "trusted_or_customer_record",
        })

    onu_filters = []
    if mac_fragment or re.search(r"\d", q):
        onu_filters.extend([
            models.ONULatest.mac_address.ilike(pattern),
            models.ONULatest.olt_host.ilike(pattern),
            models.ONULatest.pon_port.ilike(pattern),
        ])
    if mac_pattern:
        onu_filters.append(
            func.replace(
                func.replace(func.upper(models.ONULatest.mac_address), ":", ""),
                "-",
                "",
            ).ilike(mac_pattern)
        )
    onus = []
    if onu_filters and len(results) < limit:
        onus = db.query(models.ONULatest).filter(or_(*onu_filters)).order_by(models.ONULatest.polled_at.desc().nullslast()).limit(limit).all()

    for onu in onus:
        customer = find_customer_for_observed_onu(
            db,
            onu.mac_address,
            olt_host=onu.olt_host,
            pon_port=onu.pon_port,
            onu_index=onu.onu_index,
        )
        if customer is None:
            customer = _fuzzy_find_customer(_load_customer_index(db), onu.mac_address)
        key = f"onu:{onu.mac_address}"
        if key in seen_keys:
            continue
        seen_keys.add(key)
        results.append({
            "type": "onu",
            "label": _customer_name(customer) if customer else onu.mac_address,
            "subtitle": f"{onu.mac_address} | {onu.olt_host} | {onu.pon_port or '-'} #{onu.onu_index if onu.onu_index is not None else '-'}",
            "target_url": f"/onus/{onu.mac_address}",
            "customer_username": customer.username if customer else None,
            "mac_address": onu.mac_address,
            "status": onu.status,
            "match_source": "live_onu",
        })

    return {"results": results[:limit], "total": len(results)}


def get_maintenance_schedule(db: Session) -> Dict[str, Any]:
    """
    Return ONUs requiring maintenance sorted by priority.
    Joins onu_latest with predictions table for slope data.
    """
    rows = db.execute(text("""
        SELECT o.mac_address, o.olt_host, o.pon_port, o.onu_index, o.rx_power_dbm,
               p.rx_slope_7d, p.recommended_action,
               p.customer_name, p.customer_phone
        FROM onu_latest o
        LEFT JOIN predictions p ON p.mac_address = o.mac_address
        WHERE o.rx_power_dbm IS NOT NULL AND o.rx_power_dbm < -24.0
        ORDER BY o.rx_power_dbm ASC
        LIMIT 200
    """)).fetchall()

    items = []
    critical_count = 0
    high_count = 0

    for row in rows:
        mac, olt_host, pon_port, onu_index, rx = row[0], row[1], row[2], row[3], row[4]
        slope = row[5]
        action = row[6] or ("DISPATCH NOW — fiber critical, OTDR test required" if rx < -27.0 else "Schedule fiber check within 48h")
        cust_name = row[7]
        cust_phone = row[8]

        if rx < -27.0:
            signal_level = "critical"
            priority = 1
            critical_count += 1
        else:
            signal_level = "weak"
            priority = 2 if (slope is not None and slope < -0.2) else 3
            high_count += 1

        items.append({
            "mac_address": mac,
            "olt_host": olt_host or "",
            "pon_port": pon_port,
            "onu_index": onu_index,
            "rx_power_dbm": float(rx) if rx else None,
            "rx_slope_7d": float(slope) if slope is not None else None,
            "signal_level": signal_level,
            "recommended_action": action,
            "customer_name": cust_name,
            "customer_phone": cust_phone,
            "priority": priority,
        })

    items.sort(key=lambda x: x["priority"])
    return {
        "items": items,
        "total": len(items),
        "critical_count": critical_count,
        "high_count": high_count,
    }


def _as_utc(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _age_seconds(now: datetime, value: Any) -> Optional[float]:
    dt = _as_utc(value)
    if not dt:
        return None
    return max((now - dt).total_seconds(), 0.0)


def _status_from_age(age: Optional[float], warn_after: int, critical_after: int) -> str:
    if age is None:
        return "unknown"
    if age > critical_after:
        return "critical"
    if age > warn_after:
        return "warning"
    return "ok"


def _check_collector_reachability(ip_value: Any, timeout_ms: int = 900) -> Dict[str, Any]:
    """Best-effort ICMP check for collector/Tailscale IPs without using a shell."""
    if not ip_value or not isinstance(ip_value, str):
        return {"checked": False, "reason": "no_ip"}

    ip_text = ip_value.strip()
    try:
        ip = ipaddress.ip_address(ip_text)
    except ValueError:
        return {"checked": False, "reason": "invalid_ip"}

    if ip.version != 4:
        return {"checked": False, "reason": "non_ipv4"}

    is_tailscale = ip_text.startswith("100.")
    if not is_tailscale and not ip.is_private:
        return {"checked": False, "reason": "public_ip_not_pinged"}

    if platform.system().lower().startswith("win"):
        cmd = ["ping", "-n", "1", "-w", str(timeout_ms), ip_text]
    else:
        cmd = ["ping", "-c", "1", "-W", str(max(1, round(timeout_ms / 1000))), ip_text]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=(timeout_ms / 1000) + 0.7,
            check=False,
        )
    except Exception as exc:
        return {"checked": True, "reachable": False, "reason": type(exc).__name__}

    output = (result.stdout or result.stderr or "").strip()
    return {
        "checked": True,
        "reachable": result.returncode == 0,
        "exit_code": result.returncode,
        "tailscale_ip": is_tailscale,
        "sample": output[:240],
    }


def _component(
    *,
    name: str,
    category: str,
    status: str,
    message: str,
    last_seen: Any = None,
    age_seconds: Optional[float] = None,
    details: Optional[Dict[str, Any]] = None,
    operator_action: Optional[str] = None,
) -> Dict[str, Any]:
    if operator_action is None:
        operator_action = _default_operator_action(name, category, status)
    return {
        "name": name,
        "category": category,
        "status": status,
        "message": message,
        "operator_action": operator_action,
        "last_seen": _as_utc(last_seen),
        "age_seconds": round(age_seconds, 1) if age_seconds is not None else None,
        "details": details or {},
    }


def _default_operator_action(name: str, category: str, status: str) -> str:
    if status == "ok":
        return "No operator action required."
    if category == "network":
        return "Check collector heartbeat, Pi service, OLT LAN reachability, and run a force poll after recovery."
    if category == "collector":
        return "Check the Pi collector logs, ingest token, backend URL, Tailscale link, and restart the collector service if stale."
    if category == "scraper":
        return "Open the scraper dashboard, inspect scheduler/sync logs, and refresh the Railwire session if authentication expired."
    if category == "workers":
        return "Run or restart the worker, then confirm the latest output timestamp moves forward."
    if name == "Backend Database":
        return "Check PostgreSQL service, credentials, disk space, and restore path if the database is unavailable."
    if name == "Media Storage":
        return "Verify the uploads directory path and permissions; restore media backup if files are missing."
    if name == "Backup & Restore":
        return "Run scripts\\backup_restore_check.ps1 with -RestoreToTempDb, confirm uploads are copied, and configure off-host backup if skipped."
    if name == "NOC WebSocket":
        return "Refresh the dashboard and check backend WebSocket auth/logs if realtime updates do not resume."
    return "Check recent logs for this component and follow the runbook before marking it healthy."


def _parse_manifest_file(path: str) -> Dict[str, str]:
    values: Dict[str, str] = {}
    with open(path, "r", encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip()
    return values


def _read_backup_schedule() -> Dict[str, str]:
    if platform.system().lower() != "windows":
        return {"status": "unavailable", "reason": "scheduled task check is Windows-only"}

    try:
        completed = subprocess.run(
            [
                "schtasks",
                "/Query",
                "/TN",
                "RicoNet Daily Backup",
                "/FO",
                "CSV",
                "/V",
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except Exception as exc:
        return {"status": "error", "reason": str(exc)}

    if completed.returncode != 0:
        return {
            "status": "missing",
            "reason": (completed.stderr or completed.stdout or "scheduled task not found").strip()[:240],
        }

    try:
        rows = list(csv.DictReader(completed.stdout.splitlines()))
    except Exception as exc:
        return {"status": "error", "reason": f"could not parse schtasks output: {exc}"}
    if not rows:
        return {"status": "missing", "reason": "scheduled task query returned no rows"}

    row = rows[0]
    return {
        "status": row.get("Status") or "unknown",
        "task_name": row.get("TaskName") or "RicoNet Daily Backup",
        "last_run_time": row.get("Last Run Time") or "",
        "last_result": row.get("Last Result") or "",
        "next_run_time": row.get("Next Run Time") or "",
        "schedule": row.get("Schedule Type") or "",
    }


def _read_backup_health(now: datetime) -> Dict[str, Any]:
    root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    backup_root = os.path.join(root_dir, "backups")
    backup_schedule = _read_backup_schedule()
    if not os.path.isdir(backup_root):
        return _component(
            name="Backup & Restore",
            category="core",
            status="critical",
            message="Backup directory does not exist",
            details={"backup_root": backup_root, "scheduled_task": backup_schedule},
        )

    backup_dirs = [
        entry for entry in os.scandir(backup_root)
        if entry.is_dir()
    ]
    backup_dirs.sort(key=lambda entry: entry.name, reverse=True)
    for entry in backup_dirs:
        manifest_path = os.path.join(entry.path, "backup_manifest.txt")
        if not os.path.exists(manifest_path):
            continue
        try:
            manifest = _parse_manifest_file(manifest_path)
        except Exception as exc:
            return _component(
                name="Backup & Restore",
                category="core",
                status="critical",
                message=f"Latest backup manifest could not be read: {exc}",
                details={"manifest_path": manifest_path},
            )

        created_at = _as_utc(manifest.get("created_at")) or datetime.fromtimestamp(entry.stat().st_mtime, timezone.utc)
        age = _age_seconds(now, created_at)
        rpo_hours = 24
        try:
            rpo_hours = int(float(manifest.get("rpo_hours") or "24"))
        except Exception:
            pass

        temp_restore = (manifest.get("temp_restore") or "").lower()
        uploads_copied = (manifest.get("uploads_copied") or "").lower()
        off_host_copy = manifest.get("off_host_copy") or ""
        retention_days = manifest.get("retention_days") or ""

        status = _status_from_age(age, warn_after=rpo_hours * 3600, critical_after=rpo_hours * 3600 * 2)
        findings: List[str] = []
        if temp_restore != "passed":
            status = "critical"
            findings.append("restore proof missing")
        if uploads_copied != "true":
            status = "critical"
            findings.append("uploads not copied")
        if not off_host_copy or off_host_copy == "skipped":
            if status == "ok":
                status = "warning"
            findings.append("off-host copy skipped")
        if retention_days in {"", "disabled"}:
            if status == "ok":
                status = "warning"
            findings.append("retention disabled")
        if backup_schedule.get("status") == "missing":
            if status == "ok":
                status = "warning"
            findings.append("scheduled task missing")
        elif backup_schedule.get("status") == "error":
            if status == "ok":
                status = "warning"
            findings.append("scheduled task check failed")

        message = f"Latest backup {entry.name}; restore={temp_restore or 'unknown'}; uploads_copied={uploads_copied or 'unknown'}"
        if findings:
            message += "; " + ", ".join(findings)

        return _component(
            name="Backup & Restore",
            category="core",
            status=status,
            message=message,
            last_seen=created_at,
            age_seconds=age,
            details={
                "backup_dir": entry.path,
                "manifest_path": manifest_path,
                "dump_bytes": manifest.get("dump_bytes"),
                "restore_list_entries": manifest.get("restore_list_entries"),
                "temp_restore": temp_restore,
                "uploads_copied": uploads_copied,
                "uploads_backup_dir": manifest.get("uploads_backup_dir"),
                "off_host_copy": off_host_copy,
                "retention_days": retention_days,
                "rpo_hours": manifest.get("rpo_hours"),
                "rto_hours": manifest.get("rto_hours"),
                "scheduled_task": backup_schedule,
            },
        )

    return _component(
        name="Backup & Restore",
        category="core",
        status="critical",
        message="No backup manifest found",
        details={"backup_root": backup_root, "scheduled_task": backup_schedule},
    )


def _read_media_storage_health(db: Session, now: datetime) -> Dict[str, Any]:
    upload_dir = os.path.abspath(settings.UPLOAD_DIR)
    upload_ok = os.path.isdir(upload_dir) and os.access(upload_dir, os.R_OK | os.W_OK)
    if not upload_ok:
        return _component(
            name="Media Storage",
            category="core",
            status="critical",
            message="Upload directory is missing or not writable",
            details={"upload_dir": upload_dir},
        )

    try:
        from services import media_audit_service

        audit = media_audit_service.get_media_audit(db, include_orphans=True, limit=10)
        summary = audit["summary"]
        missing_count = int(summary.get("missing_files") or 0)
        orphan_count = int(summary.get("orphan_files") or 0)
        duplicate_count = int(summary.get("duplicate_references") or 0)

        status = "ok"
        findings: List[str] = []
        if missing_count:
            status = "critical"
            findings.append(f"{missing_count} referenced file(s) missing")
        if orphan_count:
            if status == "ok":
                status = "warning"
            findings.append(f"{orphan_count} orphan file(s)")
        if duplicate_count:
            if status == "ok":
                status = "warning"
            findings.append(f"{duplicate_count} duplicate reference(s)")

        message = "Upload directory is readable, writable, and media references are consistent"
        if findings:
            message = "Upload directory is readable and writable; " + ", ".join(findings)

        return _component(
            name="Media Storage",
            category="core",
            status=status,
            message=message,
            operator_action=(
                "Open /noc/media-audit, restore missing files from backup, and review orphan files before deleting them."
                if status != "ok"
                else None
            ),
            last_seen=now,
            age_seconds=0,
            details={
                "upload_dir": upload_dir,
                **summary,
                "sample_missing_files": [item["url"] for item in audit.get("missing_files", [])[:3]],
                "sample_orphan_files": [item["url"] for item in audit.get("orphan_files", [])[:3]],
            },
        )
    except Exception as exc:
        logger.exception("Media storage audit failed")
        return _component(
            name="Media Storage",
            category="core",
            status="warning",
            message=f"Upload directory is readable and writable, but media audit failed: {exc}",
            operator_action="Check backend logs, then run GET /noc/media-audit after the error is fixed.",
            last_seen=now,
            age_seconds=0,
            details={"upload_dir": upload_dir, "audit_error": str(exc)},
        )


def _read_scraper_heartbeat(now: datetime) -> Dict[str, Any]:
    root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    runtime_dir = os.getenv("RICO_SCRAPER_RUNTIME_DIR")
    if not runtime_dir:
        local_app_data = os.getenv("LOCALAPPDATA")
        runtime_dir = os.path.join(local_app_data, "RicoNet", "scraper") if local_app_data else os.path.join(os.path.expanduser("~"), ".rico", "scraper")
    runtime_heartbeat_path = os.path.join(runtime_dir, "scheduler_heartbeat.json")
    legacy_heartbeat_path = os.path.join(root_dir, "scraper", "scheduler_heartbeat.json")
    heartbeat_path = runtime_heartbeat_path if os.path.exists(runtime_heartbeat_path) else legacy_heartbeat_path
    scheduler_action = (
        "Start or restart Scraper Scheduler from the control panel, then confirm scheduler_heartbeat.json updates every minute. "
        "If the next job fails, refresh the Railwire session from the scraper dashboard."
    )
    if not os.path.exists(heartbeat_path):
        return _component(
            name="Scraper Scheduler",
            category="scraper",
            status="unknown",
            message="scheduler_heartbeat.json not found",
            operator_action=scheduler_action,
            details={"path": heartbeat_path},
        )

    try:
        with open(heartbeat_path, "r", encoding="utf-8") as handle:
            heartbeat = json.load(handle)
    except Exception as exc:
        return _component(
            name="Scraper Scheduler",
            category="scraper",
            status="critical",
            message=f"Heartbeat file could not be read: {exc}",
            operator_action=scheduler_action,
            details={"path": heartbeat_path},
        )

    last_seen = _as_utc(heartbeat.get("ts"))
    age = _age_seconds(now, last_seen)
    status = _status_from_age(age, warn_after=180, critical_after=300)
    heartbeat_status = heartbeat.get("status") or "unknown"
    message = heartbeat.get("message") or f"Heartbeat status: {heartbeat_status}"
    if heartbeat_status in {"error", "session_error", "stopped"}:
        status = "critical"
    elif heartbeat_status not in {"idle", "running", "starting"} and status == "ok":
        status = "warning"
    elif heartbeat_status in {"idle", "running", "starting"} and status in {"warning", "critical"}:
        if age is None:
            message = f"Heartbeat timestamp missing; scheduler reports {heartbeat_status}"
        else:
            message = f"Heartbeat stale for {round(age / 60, 1)} minutes; scheduler last reported {heartbeat_status}"

    return _component(
        name="Scraper Scheduler",
        category="scraper",
        status=status,
        message=message,
        operator_action=scheduler_action if status != "ok" else None,
        last_seen=last_seen,
        age_seconds=age,
        details={
            "heartbeat_status": heartbeat_status,
            "pid": heartbeat.get("pid"),
            "path": heartbeat_path,
        },
    )


def _read_scraper_sync_health(db: Session, now: datetime) -> Dict[str, Any]:
    try:
        dialect = db.bind.dialect.name if db.bind is not None else ""
        if dialect == "postgresql":
            exists = db.execute(text("SELECT to_regclass('public.scraper_health') IS NOT NULL")).scalar()
        else:
            exists = db.execute(text(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'scraper_health'"
            )).scalar() is not None
        if not exists:
            root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
            runtime_dir = os.getenv("RICO_SCRAPER_RUNTIME_DIR")
            if not runtime_dir:
                local_app_data = os.getenv("LOCALAPPDATA")
                runtime_dir = os.path.join(local_app_data, "RicoNet", "scraper") if local_app_data else os.path.join(os.path.expanduser("~"), ".rico", "scraper")
            fallback_files = {
                "sync_watermark": os.path.join(runtime_dir, ".sync_watermark"),
                "legacy_sync_watermark": os.path.join(root_dir, "scraper", ".sync_watermark"),
                "subscribers_csv": os.path.join(root_dir, "scraper", "subscribers.csv"),
                "sync_daemon_log": os.path.join(root_dir, "scraper", "sync_daemon.log"),
            }
            existing_files = {
                key: path for key, path in fallback_files.items()
                if os.path.exists(path)
            }
            mtimes = [
                datetime.fromtimestamp(os.path.getmtime(path), timezone.utc)
                for path in existing_files.values()
            ]
            last_seen = max(mtimes) if mtimes else None
            age = _age_seconds(now, last_seen)
            return _component(
                name="Railwire Sync",
                category="scraper",
                status=_status_from_age(age, warn_after=6 * 3600, critical_after=24 * 3600),
                message="Using scraper file timestamps because scraper_health table is not available",
                last_seen=last_seen,
                age_seconds=age,
                details={
                    "source": "file_mtime_fallback",
                    "files": existing_files,
                    "warn_after_seconds": 6 * 3600,
                    "critical_after_seconds": 24 * 3600,
                },
            )

        rows = db.execute(text("""
            SELECT key, value, updated_at
            FROM scraper_health
            ORDER BY key
        """)).mappings().all()
    except Exception as exc:
        return _component(
            name="Railwire Sync",
            category="scraper",
            status="warning",
            message=f"Could not read scraper health: {exc}",
        )

    values = {row["key"]: row["value"] for row in rows}
    updated_at_values = [_as_utc(row["updated_at"]) for row in rows if row.get("updated_at")]
    last_seen = max(updated_at_values) if updated_at_values else None
    explicit_sync = _as_utc(values.get("last_sync_at") or values.get("last_csv_sync_at"))
    if explicit_sync:
        last_seen = explicit_sync

    age = _age_seconds(now, last_seen)
    status = _status_from_age(age, warn_after=1800, critical_after=7200)
    last_status = values.get("last_sync_status") or values.get("last_customer_sync_status")
    if last_status and last_status.lower() not in {"ok", "success", "idle"} and status == "ok":
        status = "warning"

    sync_state_details: Dict[str, Any] = {}
    try:
        dialect = db.bind.dialect.name if db.bind is not None else ""
        if dialect == "postgresql":
            state_exists = db.execute(text("SELECT to_regclass('public.customer_sync_state') IS NOT NULL")).scalar()
        else:
            state_exists = db.execute(text(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'customer_sync_state'"
            )).scalar() is not None
        if state_exists:
            state = db.execute(text("""
                SELECT
                    COUNT(*) AS customer_sync_state_rows,
                    SUM(CASE WHEN last_status = 'error' THEN 1 ELSE 0 END) AS customer_sync_errors,
                    MAX(last_synced_at) AS latest_customer_sync_at,
                    MAX(source_updated_at) AS latest_source_updated_at,
                    MAX(error_count) AS max_error_count
                FROM customer_sync_state
            """)).mappings().first()
            if state:
                sync_state_details = dict(state)
                if int(state.get("customer_sync_errors") or 0) > 0 and status == "ok":
                    status = "warning"
    except Exception as exc:
        sync_state_details = {"customer_sync_state_error": str(exc)}
        if status == "ok":
            status = "warning"

    return _component(
        name="Railwire Sync",
        category="scraper",
        status=status,
        message=f"{len(values)} scraper health keys available",
        last_seen=last_seen,
        age_seconds=age,
        details={
            "last_sync_at": values.get("last_sync_at"),
            "last_csv_sync_at": values.get("last_csv_sync_at"),
            "last_sync_customers": values.get("last_sync_customers"),
            "csv_total_in_railwire": values.get("csv_total_in_railwire"),
            "csv_not_found_count": values.get("csv_not_found_count"),
            **sync_state_details,
        },
    )


def get_system_health(db: Session) -> Dict[str, Any]:
    """NOC operator health view for core production dependencies."""
    now = datetime.now(timezone.utc)
    components: List[Dict[str, Any]] = []

    try:
        db.execute(text("SELECT 1")).scalar()
        components.append(_component(
            name="Backend Database",
            category="core",
            status="ok",
            message="Database query succeeded",
            last_seen=now,
            age_seconds=0,
        ))
    except Exception as exc:
        components.append(_component(
            name="Backend Database",
            category="core",
            status="critical",
            message=f"Database query failed: {exc}",
        ))

    components.append(_component(
        name="Backend API",
        category="core",
        status="ok",
        message="NOC API request completed",
        last_seen=now,
        age_seconds=0,
    ))

    components.append(_read_media_storage_health(db, now))
    components.append(_read_backup_health(now))

    last_poll = db.query(func.max(models.ONULatest.polled_at)).scalar()
    last_poll_age = _age_seconds(now, last_poll)
    onu_count = db.query(func.count(models.ONULatest.mac_address)).scalar() or 0
    components.append(_component(
        name="OLT Ingest Freshness",
        category="network",
        status=_status_from_age(last_poll_age, warn_after=600, critical_after=1800),
        message=f"{onu_count} ONU latest records; newest poll controls NOC freshness",
        last_seen=last_poll,
        age_seconds=last_poll_age,
        details={"onu_count": onu_count, "warn_after_seconds": 600, "critical_after_seconds": 1800},
    ))

    olt_rows = db.query(
        models.ONULatest.olt_host,
        func.count(models.ONULatest.mac_address),
        func.sum(case((func.lower(models.ONULatest.status) == "online", 1), else_=0)),
        func.max(models.ONULatest.polled_at),
    ).filter(
        models.ONULatest.olt_host.isnot(None)
    ).group_by(models.ONULatest.olt_host).all()
    olt_latest = {
        row[0]: {"onu_count": row[1] or 0, "online": row[2] or 0, "last_poll": row[3]}
        for row in olt_rows
        if row[0]
    }
    health_rows = {
        row.olt_host: row
        for row in db.query(models.OLTHealth).all()
        if row.olt_host
    }
    known_olt_hosts = set(OLT_CAPABILITIES.keys())
    for olt_host in sorted(set(olt_latest.keys()) | set(health_rows.keys()) | known_olt_hosts):
        health = health_rows.get(olt_host)
        observed = olt_latest.get(olt_host, {})
        last_seen = health.last_snapshot_at if health and health.last_snapshot_at else observed.get("last_poll")
        age = _age_seconds(now, last_seen)
        status = _status_from_age(age, warn_after=600, critical_after=1800)
        cap = serialize_olt_capability(olt_host)
        observed_count = observed.get("onu_count", 0)
        online_count = observed.get("online", 0)
        missing_feed = olt_host in known_olt_hosts and not health and not observed
        if health and health.status == "unreachable":
            status = "critical"
        elif health and health.status == "stale" and status == "ok":
            status = "warning"
        elif missing_feed:
            status = "critical"
        if missing_feed:
            message = "No collector snapshot has been received for this configured OLT."
        else:
            message = f"{online_count} online of {observed_count} observed ONUs"
        operator_action = None
        if status != "ok":
            operator_action = (
                "Check collector heartbeat, Pi/Tailscale connectivity, SNMP read access, and the OLT capability notes. "
                "Do not trust NOC live cards for this OLT until this component returns OK."
            )
        components.append(_component(
            name=f"OLT {olt_host}",
            category="network",
            status=status,
            message=message,
            last_seen=last_seen,
            age_seconds=age,
            details={
                "capability": cap,
                "olt_status": health.status if health else "untracked",
                "last_trap_at": health.last_trap_at if health else None,
                "stale_since": health.stale_since if health else None,
                "snapshot_count_24h": health.snapshot_count_24h if health else None,
                "collector_id": getattr(health, "collector_id", None) if health else None,
                "collector_name": getattr(health, "collector_name", None) if health else None,
                "collector_hostname": getattr(health, "collector_hostname", None) if health else None,
                "collector_ip": getattr(health, "collector_ip", None) if health else None,
                "collector_version": getattr(health, "collector_version", None) if health else None,
                "last_collector_seen_at": getattr(health, "last_collector_seen_at", None) if health else None,
                "last_batch_size": getattr(health, "last_batch_size", None) if health else None,
                "onu_count": observed_count,
                "online": online_count,
            },
            operator_action=operator_action,
        ))

    collectors: Dict[str, Dict[str, Any]] = {}
    retired_collector_ids = set()
    for row in db.query(models.CollectorHealth).all():
        if (row.last_status or "").lower() in {"retired", "disabled"}:
            if row.collector_id:
                retired_collector_ids.add(row.collector_id)
            continue
        collectors[row.collector_id] = {
            "collector_id": row.collector_id,
            "collector_name": row.collector_name,
            "collector_hostname": row.collector_hostname,
            "collector_ip": row.collector_ip,
            "collector_version": row.collector_version,
            "collector_started_at": row.collector_started_at,
            "last_seen": row.last_heartbeat_at,
            "last_snapshot_at": row.last_snapshot_at,
            "last_status": row.last_status,
            "last_message": row.last_message,
            "backend_url": row.backend_url,
            "olts": row.configured_olts or [],
            "last_batch_total": row.last_batch_total or 0,
            "heartbeat_count": row.heartbeat_count,
            "source": "heartbeat",
        }

    for health in health_rows.values():
        collector_id = getattr(health, "collector_id", None)
        if collector_id and collector_id in retired_collector_ids:
            continue
        collector_ip = getattr(health, "collector_ip", None)
        collector_hostname = getattr(health, "collector_hostname", None)
        key = collector_id or collector_ip or collector_hostname or f"unidentified:{health.olt_host}"
        if key not in collectors:
            collectors[key] = {
                "collector_id": collector_id,
                "collector_name": getattr(health, "collector_name", None),
                "collector_hostname": collector_hostname,
                "collector_ip": collector_ip,
                "collector_version": getattr(health, "collector_version", None),
                "collector_started_at": getattr(health, "collector_started_at", None),
                "last_seen": getattr(health, "last_collector_seen_at", None) or health.last_snapshot_at,
                "last_snapshot_at": health.last_snapshot_at,
                "last_status": "ingest_seen",
                "last_message": None,
                "backend_url": None,
                "olts": [],
                "last_batch_total": 0,
                "heartbeat_count": None,
                "source": "olt_ingest",
            }
        group = collectors[key]
        if health.olt_host not in group["olts"]:
            group["olts"].append(health.olt_host)
        group["last_batch_total"] += getattr(health, "last_batch_size", None) or 0
        seen = getattr(health, "last_collector_seen_at", None) or health.last_snapshot_at
        if seen and (not group["last_seen"] or _as_utc(seen) > _as_utc(group["last_seen"])):
            group["last_seen"] = seen
        if health.last_snapshot_at and (
            not group.get("last_snapshot_at")
            or _as_utc(health.last_snapshot_at) > _as_utc(group.get("last_snapshot_at"))
        ):
            group["last_snapshot_at"] = health.last_snapshot_at

    for key, collector in sorted(collectors.items(), key=lambda item: item[0]):
        age = _age_seconds(now, collector["last_seen"])
        ip = collector.get("collector_ip")
        tailscale_hint = bool(isinstance(ip, str) and ip.startswith("100."))
        collector_status = collector.get("last_status")
        reachability = _check_collector_reachability(ip)
        if collector_status in {"error", "backend_unreachable", "olt_error", "parse_error"}:
            health_status = "critical"
        else:
            health_status = _status_from_age(age, warn_after=600, critical_after=1800)
        # Tailscale and firewalls often block ICMP even when SSH/API traffic works.
        # Treat heartbeat age and explicit collector status as authoritative; keep
        # ping only as diagnostic detail so healthy collectors are not downgraded.
        reachability_message = ""
        if reachability.get("checked"):
            reachability_message = "; ping reachable" if reachability.get("reachable") else "; ping not reachable"
        components.append(_component(
            name=collector.get("collector_name") or collector.get("collector_id") or collector.get("collector_hostname") or "Unidentified Collector",
            category="collector",
            status=health_status,
            message=(collector.get("last_message") or f"Feeds {len(collector['olts'])} OLT(s); {'Tailscale IP observed' if tailscale_hint else 'collector path inferred from ingest'}") + reachability_message,
            last_seen=collector["last_seen"],
            age_seconds=age,
            details={
                "collector_id": collector.get("collector_id"),
                "hostname": collector.get("collector_hostname"),
                "ip": ip,
                "version": collector.get("collector_version"),
                "started_at": collector.get("collector_started_at"),
                "last_snapshot_at": collector.get("last_snapshot_at"),
                "last_status": collector.get("last_status"),
                "backend_url": collector.get("backend_url"),
                "olts": collector["olts"],
                "last_batch_total": collector["last_batch_total"],
                "heartbeat_count": collector.get("heartbeat_count"),
                "source": collector.get("source"),
                "tailscale_ip_observed": tailscale_hint,
                "reachability": reachability,
            },
        ))

    components.append(_read_scraper_heartbeat(now))
    components.append(_read_scraper_sync_health(db, now))

    prediction_last = db.execute(text("SELECT MAX(last_computed) FROM predictions")).scalar()
    prediction_age = _age_seconds(now, prediction_last)
    prediction_count = db.execute(text("SELECT COUNT(*) FROM predictions")).scalar() or 0
    components.append(_component(
        name="Prediction Worker",
        category="workers",
        status=_status_from_age(prediction_age, warn_after=36 * 3600, critical_after=72 * 3600),
        message=f"{prediction_count} prediction rows available",
        last_seen=prediction_last,
        age_seconds=prediction_age,
        details={"prediction_count": prediction_count},
    ))

    try:
        from services.ws_manager import ws_manager
        noc_connections = ws_manager.connection_count("noc")
    except Exception:
        noc_connections = 0
    components.append(_component(
        name="NOC WebSocket",
        category="core",
        status="ok",
        message=f"{noc_connections} active NOC realtime connection(s)",
        last_seen=now,
        age_seconds=0,
        details={"active_connections": noc_connections},
    ))

    severity = {"ok": 0, "unknown": 1, "warning": 2, "critical": 3}
    counts = {"ok": 0, "warning": 0, "critical": 0, "unknown": 0}
    for component in components:
        counts[component["status"]] = counts.get(component["status"], 0) + 1
    overall_status = max((c["status"] for c in components), key=lambda s: severity.get(s, 0))

    return {
        "generated_at": now,
        "overall_status": overall_status,
        "counts": counts,
        "components": components,
    }


def get_health_report(db: Session) -> Dict[str, Any]:
    """Generate a full network health report."""
    now = datetime.now(timezone.utc)

    # ONU counts
    onu_rows = db.execute(text("""
        SELECT COUNT(*) as total,
               COUNT(*) FILTER (WHERE status = 'online') as online,
               COUNT(*) FILTER (WHERE rx_power_dbm < -27.0) as critical_signal,
               COUNT(*) FILTER (WHERE rx_power_dbm BETWEEN -27.0 AND -24.0) as weak_signal,
               AVG(rx_power_dbm) FILTER (WHERE rx_power_dbm IS NOT NULL) as avg_rx
        FROM onu_latest
    """)).fetchone()

    total = onu_rows[0] or 0
    online = onu_rows[1] or 0
    offline = total - online
    critical_signal = onu_rows[2] or 0
    weak_signal = onu_rows[3] or 0
    avg_rx = float(onu_rows[4]) if onu_rows[4] is not None else None
    online_pct = round(100.0 * online / total, 1) if total > 0 else 0.0

    # Predictions
    pred_rows = db.execute(text("""
        SELECT COUNT(*) as total,
               COUNT(*) FILTER (WHERE fiber_risk IN ('HIGH','CRITICAL')) as high_fiber,
               COUNT(*) FILTER (WHERE churn_risk = 'HIGH') as high_churn,
               AVG(health_score) as avg_health
        FROM predictions
    """)).fetchone()
    total_preds = pred_rows[0] or 0
    high_fiber = pred_rows[1] or 0
    high_churn = pred_rows[2] or 0
    avg_health = float(pred_rows[3]) if pred_rows[3] is not None else None

    # Open tickets
    open_tickets = db.execute(text(
        "SELECT COUNT(*) FROM tickets WHERE status NOT IN ('closed','resolved','completed')"
    )).scalar() or 0

    # Alarm counts
    alarm_24h = db.execute(text(
        "SELECT COUNT(*) FROM alarm_events WHERE received_at >= NOW() - INTERVAL '24 hours'"
    )).scalar() or 0
    alarm_7d = db.execute(text(
        "SELECT COUNT(*) FROM alarm_events WHERE received_at >= NOW() - INTERVAL '7 days'"
    )).scalar() or 0

    return {
        "generated_at": now,
        "total_onus": total,
        "online": online,
        "offline": offline,
        "online_pct": online_pct,
        "critical_signal": critical_signal,
        "weak_signal": weak_signal,
        "avg_rx_power": avg_rx,
        "avg_health_score": avg_health,
        "predictions_available": total_preds > 0,
        "total_predictions": total_preds,
        "high_fiber_risk": high_fiber,
        "high_churn_risk": high_churn,
        "open_tickets": open_tickets,
        "alarm_count_24h": alarm_24h,
        "alarm_count_7d": alarm_7d,
    }


def get_unlinked_onus(db: Session) -> List[Dict[str, Any]]:
    """Return ONUs that have no customer match (for manual linking UI)."""
    all_onus = db.query(models.ONULatest).order_by(
        models.ONULatest.pon_port, models.ONULatest.onu_index
    ).all()

    cust_index = _load_customer_index(db)

    unlinked = []
    for onu in all_onus:
        if not onu.mac_address:
            continue
        customer = find_customer_for_observed_onu(
            db,
            onu.mac_address,
            olt_host=onu.olt_host,
            pon_port=onu.pon_port,
            onu_index=onu.onu_index,
        ) or _fuzzy_find_customer(cust_index, onu.mac_address)
        if customer is None:
            unlinked.append({
                "mac_address": onu.mac_address,
                "status": onu.status,
                "rx_power_dbm": float(onu.rx_power_dbm) if onu.rx_power_dbm else None,
                "pon_port": onu.pon_port,
                "onu_index": onu.onu_index,
                "olt_host": onu.olt_host,
            })

    return unlinked


def get_orphan_onus(db: Session, include_offline: bool = False) -> Dict[str, Any]:
    """
    Find ONUs that should not silently remain in service.

    Cases:
    - Missing customer: OLT still sees the ONU, but no trusted binding or MAC
      offset match points to a customer.
    - Inactive customer: trusted/fuzzy customer exists, but billing/customer
      status is not active.
    - Expired customer: account is active-looking but expiry_date is in the past.
    """
    query = db.query(models.ONULatest)
    if not include_offline:
        query = query.filter(func.lower(models.ONULatest.status) == "online")

    all_onus = query.order_by(
        models.ONULatest.olt_host,
        models.ONULatest.pon_port,
        models.ONULatest.onu_index,
    ).all()

    cust_index = _load_customer_index(db)
    now = datetime.now(timezone.utc)
    items: List[Dict[str, Any]] = []

    for onu in all_onus:
        if not onu.mac_address:
            continue

        binding = find_active_binding_for_observed_onu(
            db,
            onu.mac_address,
            olt_host=onu.olt_host,
            pon_port=onu.pon_port,
            onu_index=onu.onu_index,
        )
        customer = None
        match_source = "none"
        if binding:
            customer = db.query(models.Customer).filter(
                models.Customer.username == binding.customer_id
            ).first()
            match_source = "trusted_binding"
        if customer is None:
            customer = _fuzzy_find_customer(cust_index, onu.mac_address)
            if customer is not None:
                match_source = "legacy_mac_offset"

        reason = None
        severity = "medium"
        action = ""

        if customer is None:
            reason = "missing_customer"
            severity = "high" if (onu.status or "").lower() == "online" else "medium"
            action = "Audit Railwire and field records; link to the correct customer or schedule disconnect."
        elif not _is_active_customer(customer):
            reason = "inactive_customer"
            severity = "high" if (onu.status or "").lower() == "online" else "medium"
            action = "Confirm renewal/churn state; restore billing if paid or deactivate the ONU binding."
        elif _is_expired_customer(customer, now):
            reason = "expired_customer"
            severity = "medium"
            action = "Check topup status; if renewed, wait for scraper sync or refresh billing record."

        if not reason:
            continue

        items.append({
            "mac_address": onu.mac_address,
            "status": onu.status,
            "rx_power_dbm": float(onu.rx_power_dbm) if onu.rx_power_dbm is not None else None,
            "pon_port": onu.pon_port,
            "onu_index": onu.onu_index,
            "olt_host": onu.olt_host,
            "polled_at": onu.polled_at,
            "reason": reason,
            "severity": severity,
            "recommended_action": action,
            "match_source": match_source,
            "customer_username": getattr(customer, "username", None),
            "customer_name": _customer_name(customer),
            "customer_phone": getattr(customer, "phone", None),
            "customer_status": getattr(customer, "status", None),
            "customer_expiry_date": getattr(customer, "expiry_date", None),
            "binding_id": getattr(binding, "id", None),
            "binding_confidence": getattr(binding, "confidence", None),
            "binding_source": getattr(binding, "binding_source", None),
        })

    summary = {
        "total": len(items),
        "missing_customer": sum(1 for i in items if i["reason"] == "missing_customer"),
        "inactive_customer": sum(1 for i in items if i["reason"] == "inactive_customer"),
        "expired_customer": sum(1 for i in items if i["reason"] == "expired_customer"),
        "online": sum(1 for i in items if (i["status"] or "").lower() == "online"),
        "offline": sum(1 for i in items if (i["status"] or "").lower() != "online"),
    }
    return {"summary": summary, "onus": items}


def _maintenance_window_brief(row: models.OLTMaintenanceWindow, now: datetime) -> Dict[str, Any]:
    starts_at = _as_utc(row.starts_at)
    ends_at = _as_utc(row.ends_at)
    return {
        "id": row.id,
        "olt_host": row.olt_host,
        "pon_port": row.pon_port,
        "starts_at": row.starts_at,
        "ends_at": row.ends_at,
        "reason": row.reason,
        "is_current": bool(starts_at and ends_at and starts_at <= now <= ends_at),
    }


def get_shift_brief(db: Session, hours: int = 12) -> Dict[str, Any]:
    """One-screen NOC handoff summary for the next operator."""
    hours = max(1, min(hours, 24))
    now = datetime.now(timezone.utc)
    since = now - timedelta(hours=hours)

    open_alarms = db.query(models.AlarmEvent).filter(
        models.AlarmEvent.status == "open",
    ).order_by(models.AlarmEvent.received_at.desc()).limit(10).all()

    alarm_breakdown = db.query(
        models.AlarmEvent.event_type,
        func.count(models.AlarmEvent.id),
    ).filter(
        models.AlarmEvent.received_at >= since,
    ).group_by(models.AlarmEvent.event_type).order_by(func.count(models.AlarmEvent.id).desc()).limit(8).all()

    ticket_rows = db.query(
        models.Ticket.status,
        func.count(models.Ticket.id),
    ).filter(
        models.Ticket.status.in_(["Open", "Assigned", "Ongoing"]),
    ).group_by(models.Ticket.status).all()
    ticket_counts = {row[0]: row[1] for row in ticket_rows}
    overdue_tickets = db.query(func.count(models.Ticket.id)).filter(
        models.Ticket.status.in_(["Open", "Assigned"]),
        models.Ticket.created_at < (now - timedelta(hours=24)),
    ).scalar() or 0

    maintenance_rows = db.query(models.OLTMaintenanceWindow).filter(
        models.OLTMaintenanceWindow.is_active.is_(True),
        models.OLTMaintenanceWindow.ends_at >= now,
        models.OLTMaintenanceWindow.starts_at <= now + timedelta(hours=24),
    ).order_by(models.OLTMaintenanceWindow.starts_at.asc()).limit(10).all()

    orphan_report = get_orphan_onus(db)
    health = get_system_health(db)
    unhealthy_components = [
        c for c in health.get("components", [])
        if c.get("status") in {"warning", "critical"}
    ]

    actions: List[str] = []
    if open_alarms:
        actions.append(f"Review {len(open_alarms)} open alarm(s); acknowledge or suppress known maintenance noise.")
    if overdue_tickets:
        actions.append(f"Escalate {overdue_tickets} ticket(s) older than 24 hours.")
    if orphan_report["summary"]["total"]:
        actions.append(f"Audit {orphan_report['summary']['total']} orphan ONU(s) before shift end.")
    if unhealthy_components:
        actions.append(f"Check {len(unhealthy_components)} warning/critical system component(s).")
    if not actions:
        actions.append("No immediate handoff blockers detected.")

    return {
        "generated_at": now,
        "window_hours": hours,
        "alarms": {
            "open_total": db.query(func.count(models.AlarmEvent.id)).filter(
                models.AlarmEvent.status == "open",
            ).scalar() or 0,
            "received_in_window": db.query(func.count(models.AlarmEvent.id)).filter(
                models.AlarmEvent.received_at >= since,
            ).scalar() or 0,
            "breakdown": [
                {"event_type": row[0], "count": row[1]}
                for row in alarm_breakdown
            ],
            "latest_open": [
                {
                    "id": alarm.id,
                    "event_type": alarm.event_type,
                    "mac_address": alarm.mac_address,
                    "olt_host": alarm.olt_host,
                    "pon_port": alarm.pon_port,
                    "onu_index": alarm.onu_index,
                    "received_at": alarm.received_at,
                    "occurrence_count": alarm.occurrence_count,
                }
                for alarm in open_alarms
            ],
        },
        "tickets": {
            "open": ticket_counts.get("Open", 0),
            "assigned": ticket_counts.get("Assigned", 0),
            "ongoing": ticket_counts.get("Ongoing", 0),
            "overdue": overdue_tickets,
        },
        "orphan_onus": orphan_report["summary"],
        "maintenance": [_maintenance_window_brief(row, now) for row in maintenance_rows],
        "system_health": {
            "unhealthy_total": len(unhealthy_components),
            "components": unhealthy_components[:8],
        },
        "handoff_actions": actions,
    }


async def refresh_onu_signal(db: Session, mac: str) -> Optional[Dict[str, Any]]:
    """
    On-demand single-ONU signal refresh.
    Calls the Pi proxy /olt/refresh (targeted, <15s), writes result back to
    onu_latest, and returns the refreshed fields.

    Returns None if ONU not in DB, proxy disabled, or proxy call fails.
    """
    from services import olt_service

    onu = db.query(models.ONULatest).filter(
        models.ONULatest.mac_address == mac
    ).first()
    if not onu:
        logger.warning("refresh_onu_signal: MAC %s not in onu_latest", mac)
        return None

    if not onu.olt_host or not onu.pon_port or onu.onu_index is None:
        logger.warning("refresh_onu_signal: %s missing olt_host/pon_port/onu_index", mac)
        return None

    fresh = await olt_service.refresh_onu_by_port(onu.olt_host, onu.pon_port, onu.onu_index)
    if not fresh:
        return None

    # Patch onu_latest with fresh values
    if fresh.get("status"):
        onu.status = fresh["status"]
    if fresh.get("rx_power_dbm") is not None:
        onu.rx_power_dbm = fresh["rx_power_dbm"]
    if fresh.get("tx_power_dbm") is not None:
        onu.tx_power_dbm = fresh["tx_power_dbm"]
    if fresh.get("temperature_c") is not None:
        onu.temperature_c = fresh["temperature_c"]
    if fresh.get("voltage_mv") is not None:
        onu.voltage_mv = fresh["voltage_mv"]
    if "dying_gasp" in fresh:
        onu.dying_gasp = bool(fresh["dying_gasp"])

    try:
        polled_str = fresh.get("polled_at", "")
        onu.polled_at = datetime.fromisoformat(polled_str.replace("Z", "+00:00"))
    except Exception:
        onu.polled_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(onu)

    logger.info("refresh_onu_signal: %s → status=%s rx=%s",
                mac, onu.status, onu.rx_power_dbm)
    return {
        "mac_address": onu.mac_address,
        "status": onu.status,
        "rx_power_dbm": float(onu.rx_power_dbm) if onu.rx_power_dbm is not None else None,
        "tx_power_dbm": float(onu.tx_power_dbm) if onu.tx_power_dbm is not None else None,
        "temperature_c": float(onu.temperature_c) if onu.temperature_c is not None else None,
        "voltage_mv": int(onu.voltage_mv) if onu.voltage_mv is not None else None,
        "dying_gasp": onu.dying_gasp,
        "polled_at": onu.polled_at.isoformat() if onu.polled_at else None,
        "source": "proxy_refresh",
    }
