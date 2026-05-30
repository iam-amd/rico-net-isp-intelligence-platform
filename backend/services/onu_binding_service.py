"""
Trusted customer-to-ONU binding helpers.

Railwire MACs are not treated as authoritative. Field survey, manual link, and
OLT-observed identity should flow through these helpers so GPON serial and EPON
MAC rules stay consistent across NOC, diagnosis, and survey code.
"""
import re
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Set

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

import models


_HEX_12_RE = re.compile(r"^[0-9A-F]{12}$")


def normalize_mac(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    clean = re.sub(r"[\s:\-\.]", "", value.upper())
    if not _HEX_12_RE.match(clean):
        return None
    return ":".join(clean[i:i + 2] for i in range(0, 12, 2))


def normalize_serial(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    serial = value.strip().upper()
    if serial.startswith("SN:"):
        serial = serial[3:]
    serial = re.sub(r"\s+", "", serial)
    return serial or None


def build_binding_identity(
    *,
    onu_identifier: Optional[str] = None,
    ont_serial_number: Optional[str] = None,
    ont_mac_address: Optional[str] = None,
) -> Dict[str, Optional[str]]:
    """
    Build a normalized identity payload for ONUBinding.

    Rule:
    - If the explicit ONU identifier is a MAC, treat it as EPON/MAC primary.
    - If the explicit ONU identifier is not a MAC, treat it as GPON/serial primary.
    - If no explicit identifier exists, prefer serial, then MAC.
    """
    explicit = (onu_identifier or "").strip()
    explicit_mac = normalize_mac(explicit)
    explicit_serial = normalize_serial(explicit)
    serial = normalize_serial(ont_serial_number) or (
        explicit_serial if explicit and not explicit_mac else None
    )
    mac = normalize_mac(ont_mac_address) or explicit_mac

    if explicit:
        if explicit_mac:
            primary = explicit_mac
            primary_type = "mac"
            onu_type = "epon"
        else:
            primary = explicit_serial
            primary_type = "serial"
            onu_type = "gpon"
    elif serial:
        primary = serial
        primary_type = "serial"
        onu_type = "gpon"
    elif mac:
        primary = mac
        primary_type = "mac"
        onu_type = "epon"
    else:
        primary = None
        primary_type = None
        onu_type = None

    return {
        "onu_identifier": primary,
        "onu_type": onu_type,
        "primary_identifier_type": primary_type,
        "serial_number": serial,
        "mac_address": mac,
    }


def observed_lookup_values(observed_identifier: Optional[str]) -> Dict[str, Any]:
    raw = (observed_identifier or "").strip().upper()
    serial = normalize_serial(raw)
    mac = normalize_mac(raw)
    identifiers: Set[str] = set()
    if raw:
        identifiers.add(raw)
    if serial:
        identifiers.add(serial)
        identifiers.add(f"SN:{serial}")
    if mac:
        identifiers.add(mac)
        identifiers.add(mac.replace(":", ""))
    return {
        "raw": raw or None,
        "serial": serial,
        "mac": mac,
        "identifiers": {v.upper() for v in identifiers if v},
    }


def _binding_score(
    binding: models.ONUBinding,
    *,
    lookup: Dict[str, Any],
    olt_host: Optional[str],
    pon_port: Optional[str],
    onu_index: Optional[int],
) -> tuple:
    ids = lookup["identifiers"]
    identity_match = (
        (binding.onu_identifier or "").upper() in ids
        or (binding.serial_number or "").upper() in ids
        or (binding.mac_address or "").upper() in ids
    )
    placement_match = bool(
        olt_host
        and pon_port
        and onu_index is not None
        and binding.olt_host == olt_host
        and binding.pon_port == pon_port
        and binding.onu_index == onu_index
    )
    confidence_score = {"verified": 3, "probable": 2, "guess": 1}.get(
        binding.confidence or "", 0
    )
    source_score = {
        "field_scan": 4,
        "pg_survey": 4,
        "tech_scan": 4,
        "manual": 4,
        "admin_verified": 4,
        "mac_match": 2,
        "railwire_scraped": 1,
    }.get(binding.binding_source or "", 0)
    seen = binding.verified_at or binding.last_seen or binding.first_seen or datetime(1970, 1, 1, tzinfo=timezone.utc)
    return (identity_match, placement_match, confidence_score, source_score, seen)


def find_active_binding_for_observed_onu(
    db: Session,
    observed_identifier: str,
    *,
    olt_host: Optional[str] = None,
    pon_port: Optional[str] = None,
    onu_index: Optional[int] = None,
    allow_placement_match: bool = False,
) -> Optional[models.ONUBinding]:
    lookup = observed_lookup_values(observed_identifier)
    conditions = []

    ids = lookup["identifiers"]
    if ids:
        conditions.append(func.upper(models.ONUBinding.onu_identifier).in_(ids))
        conditions.append(func.upper(models.ONUBinding.serial_number).in_(ids))
        conditions.append(func.upper(models.ONUBinding.mac_address).in_(ids))

    # Placement alone is not safe for general lookups, because ONU indexes can
    # be reused. Alarm/diagnosis can opt in so a trusted slot binding outranks
    # legacy customer.mac_address fallback when the event came from that slot.
    if (allow_placement_match or not ids) and olt_host and pon_port and onu_index is not None:
        conditions.append(and_(
            models.ONUBinding.olt_host == olt_host,
            models.ONUBinding.pon_port == pon_port,
            models.ONUBinding.onu_index == onu_index,
        ))

    if not conditions:
        return None

    candidates = db.query(models.ONUBinding).filter(
        models.ONUBinding.is_active.is_(True),
        or_(*conditions),
    ).all()
    if not candidates:
        return None
    return max(
        candidates,
        key=lambda b: _binding_score(
            b,
            lookup=lookup,
            olt_host=olt_host,
            pon_port=pon_port,
            onu_index=onu_index,
        ),
    )


def find_customer_for_observed_onu(
    db: Session,
    observed_identifier: str,
    *,
    olt_host: Optional[str] = None,
    pon_port: Optional[str] = None,
    onu_index: Optional[int] = None,
    allow_placement_match: bool = False,
) -> Optional[models.Customer]:
    binding = find_active_binding_for_observed_onu(
        db,
        observed_identifier,
        olt_host=olt_host,
        pon_port=pon_port,
        onu_index=onu_index,
        allow_placement_match=allow_placement_match,
    )
    if not binding:
        return None
    return db.query(models.Customer).filter(
        models.Customer.username == binding.customer_id
    ).first()
