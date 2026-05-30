"""OLT capability catalog used by backend/NOC truth rules.

This file intentionally contains only facts that have been verified in the
live SNMP research notes. If an OLT does not support a field, callers should
return null plus a reason instead of inventing a value.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Optional


@dataclass(frozen=True)
class OLTCapability:
    host: str
    name: str
    olt_type: str
    model: str
    firmware: str
    has_lan_mac_table: bool
    lan_mac_oid: Optional[str]
    requires_survey_for_binding: bool
    has_customer_bandwidth: bool
    has_pon_bandwidth: bool
    has_offline_reason: bool
    has_traps_verified: bool
    customer_bandwidth_reason: str
    binding_match_note: str


OLT_CAPABILITIES: Dict[str, OLTCapability] = {
    "10.10.10.100": OLTCapability(
        host="10.10.10.100",
        name="EPON-Booto-Main",
        olt_type="EPON",
        model="V1600D8",
        firmware="V2.03.75R",
        has_lan_mac_table=True,
        lan_mac_oid="1.3.6.1.4.1.37950.1.1.5.10.3.8",
        requires_survey_for_binding=False,
        has_customer_bandwidth=True,
        has_pon_bandwidth=False,
        has_offline_reason=False,
        has_traps_verified=True,
        customer_bandwidth_reason="EPON .100 exposes per-ONU ifTable counters. Values are current OLT traffic counters, not customer speed-test results.",
        binding_match_note="Railwire/account MAC can be exact-matched through the EPON LAN-MAC table.",
    ),
    "10.10.10.200": OLTCapability(
        host="10.10.10.200",
        name="GPON-Booto-200",
        olt_type="GPON",
        model="V1600G1",
        firmware="V2.3.1R",
        has_lan_mac_table=False,
        lan_mac_oid=None,
        requires_survey_for_binding=True,
        has_customer_bandwidth=False,
        has_pon_bandwidth=True,
        has_offline_reason=False,
        has_traps_verified=True,
        customer_bandwidth_reason="GPON .200 firmware does not expose reliable per-customer bandwidth counters. Use PON aggregate load and Railwire session totals instead.",
        binding_match_note="No SNMP LAN-MAC table exists on this firmware; survey/Admin binding is required.",
    ),
    "10.10.10.210": OLTCapability(
        host="10.10.10.210",
        name="GPON-Booto-210",
        olt_type="GPON",
        model="V1600G1B",
        firmware="V1.4.8R",
        has_lan_mac_table=True,
        lan_mac_oid="1.3.6.1.4.1.37950.1.1.5.10.3.12",
        requires_survey_for_binding=False,
        has_customer_bandwidth=False,
        has_pon_bandwidth=True,
        has_offline_reason=True,
        has_traps_verified=False,
        customer_bandwidth_reason="GPON .210 exposes live optical/state data but not reliable per-customer traffic counters. Do not show customer Mbps from OLT snapshots.",
        binding_match_note="Railwire/account MAC can be exact-matched through the GPON .210 LAN-MAC table; trap target still needs verification.",
    ),
}


UNKNOWN_OLT_CAPABILITY = OLTCapability(
    host="unknown",
    name="Unknown OLT",
    olt_type="unknown",
    model="unknown",
    firmware="unknown",
    has_lan_mac_table=False,
    lan_mac_oid=None,
    requires_survey_for_binding=True,
    has_customer_bandwidth=False,
    has_pon_bandwidth=False,
    has_offline_reason=False,
    has_traps_verified=False,
    customer_bandwidth_reason="This OLT has no verified per-customer bandwidth capability in the Rico Net catalog.",
    binding_match_note="No verified SNMP matching path is configured; survey/Admin binding is required.",
)


def get_olt_capability(host: Optional[str]) -> OLTCapability:
    if not host:
        return UNKNOWN_OLT_CAPABILITY
    return OLT_CAPABILITIES.get(str(host), UNKNOWN_OLT_CAPABILITY)


def serialize_olt_capability(host: Optional[str]) -> Dict[str, object]:
    cap = get_olt_capability(host)
    return {
        "host": host,
        "name": cap.name,
        "olt_type": cap.olt_type,
        "model": cap.model,
        "firmware": cap.firmware,
        "has_lan_mac_table": cap.has_lan_mac_table,
        "lan_mac_oid": cap.lan_mac_oid,
        "requires_survey_for_binding": cap.requires_survey_for_binding,
        "has_customer_bandwidth": cap.has_customer_bandwidth,
        "has_pon_bandwidth": cap.has_pon_bandwidth,
        "has_offline_reason": cap.has_offline_reason,
        "has_traps_verified": cap.has_traps_verified,
        "customer_bandwidth_reason": cap.customer_bandwidth_reason,
        "binding_match_note": cap.binding_match_note,
    }
