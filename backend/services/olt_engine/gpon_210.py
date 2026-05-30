"""
GPON .210 adapter (Netlink V1600G1B, firmware V1.4.8R).

Auth via standard ifTable (per olt-proxy CLAUDE.md â€” confirmed 2026-05-03):
    .1.3.6.1.2.1.2.2.1.2.{ifIdx}   â†’ ifDescr  "GPON01ONU7" or "GPON0/1:7"
    .1.3.6.1.2.1.2.2.1.6.{ifIdx}   â†’ ifPhysAddress (MAC, Hex-STRING)
    .1.3.6.1.2.1.2.2.1.8.{ifIdx}   â†’ ifOperStatus (1=up, 2=down)

Optical (per olt-proxy CLAUDE.md):
    .1.3.6.1.4.1.37950.1.1.6.1.1.1.1.5.{P}.{N}   â†’ Phase: 3=working, 4=DyingGasp, 5=offline, 6=AuthFail
    .1.3.6.1.4.1.37950.1.1.6.1.1.3.1.6.{P}.{N}   â†’ TX Power "2.294(dBm)"
    .1.3.6.1.4.1.37950.1.1.6.1.1.3.1.7.{P}.{N}   â†’ RX Power "-13.518(dBm)" or bare
    .1.3.6.1.4.1.37950.1.1.6.1.1.3.1.8.{P}.{N}   â†’ OLT-side RX power

FDB / LAN-MAC learning (proven via snmp_lan_mac_matching_may11.md):
    .1.3.6.1.4.1.37950.1.1.5.10.3.12.1.1.6.<MAC>   (582 entries on .210)
    Note: value is just the MAC echo. Position is in a sibling column â€”
    walking + parsing both adjacent columns gives the mapping. For Step 2 we
    rely on ifTable (covers most customers); FDB can be added later.
"""
from __future__ import annotations

import re
import logging
from datetime import datetime, timezone
from typing import Dict, Optional

from . import snmp_runner
from .types import OpticalData, Position

logger = logging.getLogger("rico_net.olt_engine.gpon_210")


_GPON_NAME_RE_DASH = re.compile(r"GPON0/(\d+):(\d+)", re.IGNORECASE)   # "GPON0/4:29"
_GPON_NAME_RE_FLAT = re.compile(r"GPON(\d+)0?ONU(\d+)", re.IGNORECASE) # "GPON01ONU7"


def _parse_gpon_name(name: str) -> Optional[Position]:
    if not name:
        return None
    m = _GPON_NAME_RE_DASH.search(name)
    if m:
        return Position("10.10.10.210", f"0/{m.group(1)}", int(m.group(2)))
    m = _GPON_NAME_RE_FLAT.search(name)
    if m:
        port_part = m.group(1).lstrip("0") or "0"
        return Position("10.10.10.210", f"0/{port_part}", int(m.group(2)))
    return None


def _last_oid_tail(oid: str) -> Optional[int]:
    parts = oid.strip(".").split(".")
    try:
        return int(parts[-1])
    except (ValueError, IndexError):
        return None


class GponOLT210:
    """GPON .210 adapter."""

    olt_host = "10.10.10.210"

    IF_DESCR     = "1.3.6.1.2.1.2.2.1.2"
    IF_PHYS_ADDR = "1.3.6.1.2.1.2.2.1.6"
    IF_OPER_STAT = "1.3.6.1.2.1.2.2.1.8"

    BASE = "1.3.6.1.4.1.37950.1.1"
    PHASE_COL    = f"{BASE}.6.1.1.1.1.5"
    OPTICAL_TX   = f"{BASE}.6.1.1.3.1.6"
    OPTICAL_RX   = f"{BASE}.6.1.1.3.1.7"
    OPTICAL_OLT_RX = f"{BASE}.6.1.1.3.1.8"

    # â”€â”€â”€ auth table via ifTable â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    def walk_auth_table(self) -> Dict[str, Position]:
        """{optical_mac: Position} by joining ifDescr + ifPhysAddress."""
        descr: Dict[int, str] = {}
        for oid, val in snmp_runner.snmpbulkwalk(self.olt_host, self.IF_DESCR, timeout=180):
            n = _last_oid_tail(oid)
            s = snmp_runner.parse_string_value(val)
            if n is not None and s:
                descr[n] = s

        mac: Dict[int, str] = {}
        for oid, val in snmp_runner.snmpbulkwalk(self.olt_host, self.IF_PHYS_ADDR, timeout=180):
            n = _last_oid_tail(oid)
            m = snmp_runner.parse_hex_string_value(val)
            if n is not None and m:
                mac[n] = m

        out: Dict[str, Position] = {}
        for n, d in descr.items():
            pos = _parse_gpon_name(d)
            if not pos:
                continue
            m = mac.get(n)
            if m:
                out[m.upper()] = pos
        return out

    def walk_fdb_table(self) -> Dict[str, Position]:
        """Step 2: skip FDB for GPON .210 â€” auth_direct covers most cases.
        Vendor OID `.5.10.3.12.1.1.6` returns MAC echo; position is in sibling
        column â€” TODO map after Step 4 (faÃ§ade) is in place."""
        return {}

    # â”€â”€â”€ optical â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    def walk_optical_table(self) -> Dict[Position, OpticalData]:
        """Walk RX/TX/Phase, keyed by Position(0/P, N) from suffix .P.N."""
        now = datetime.now(timezone.utc)
        by_pos: Dict[Position, OpticalData] = {}

        def _pos_from_suffix(oid: str) -> Optional[Position]:
            parts = oid.strip(".").split(".")
            if len(parts) < 2:
                return None
            try:
                p = parts[-2]
                n = int(parts[-1])
                int(p)
                return Position("10.10.10.210", f"0/{p}", n)
            except ValueError:
                return None

        # RX power (most important)
        for oid, val in snmp_runner.snmpbulkwalk(self.olt_host, self.OPTICAL_RX, timeout=180):
            pos = _pos_from_suffix(oid)
            if not pos:
                continue
            s = snmp_runner.parse_string_value(val) or val
            s = s.replace("(dBm)", "").strip()
            try:
                rx = float(s)
            except (ValueError, TypeError):
                rx = None
            by_pos.setdefault(pos, OpticalData(polled_at=now)).rx_power_dbm = rx

        # TX power
        for oid, val in snmp_runner.snmpbulkwalk(self.olt_host, self.OPTICAL_TX, timeout=180):
            pos = _pos_from_suffix(oid)
            if not pos:
                continue
            s = snmp_runner.parse_string_value(val) or val
            s = s.replace("(dBm)", "").strip()
            try:
                tx = float(s)
            except (ValueError, TypeError):
                tx = None
            by_pos.setdefault(pos, OpticalData(polled_at=now)).tx_power_dbm = tx

        # Phase (status + dying_gasp)
        for oid, val in snmp_runner.snmpbulkwalk(self.olt_host, self.PHASE_COL, timeout=120):
            pos = _pos_from_suffix(oid)
            if not pos:
                continue
            phase = snmp_runner.parse_integer_value(val)
            data = by_pos.setdefault(pos, OpticalData(polled_at=now))
            if phase == 3:
                data.status = "online"
            elif phase == 4:
                data.status = "offline"; data.dying_gasp = True
            elif phase in (5, 6):
                data.status = "offline"

        return by_pos

    def get_position_live(self, port: str, idx: int) -> Optional[OpticalData]:
        try:
            p = port.split("/")[-1]
            int(p)
        except (ValueError, IndexError):
            return None

        now = datetime.now(timezone.utc)
        data = OpticalData(polled_at=now)

        rx_raw = snmp_runner.snmpget(self.olt_host, f"{self.OPTICAL_RX}.{p}.{idx}")
        if rx_raw:
            s = snmp_runner.parse_string_value(rx_raw) or rx_raw
            s = s.replace("(dBm)", "").strip()
            try:
                data.rx_power_dbm = float(s)
            except ValueError:
                pass

        tx_raw = snmp_runner.snmpget(self.olt_host, f"{self.OPTICAL_TX}.{p}.{idx}")
        if tx_raw:
            s = snmp_runner.parse_string_value(tx_raw) or tx_raw
            s = s.replace("(dBm)", "").strip()
            try:
                data.tx_power_dbm = float(s)
            except ValueError:
                pass

        return data if data.rx_power_dbm is not None else None
