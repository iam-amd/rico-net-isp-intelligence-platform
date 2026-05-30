"""
EPON .100 adapter (Netlink V1600D, firmware V2.03.75R).

OIDs proven by olt-proxy poller (see olt-proxy/CLAUDE.md):

  Auth table (one row per registered ONU, index N is OLT-internal):
    .1.3.6.1.4.1.37950.1.1.5.10.3.2.1.3.{N}   â†’ MAC (Hex-STRING)
    .1.3.6.1.4.1.37950.1.1.5.10.3.2.1.4.{N}   â†’ status INTEGER (1=online, 0=offline)
    .1.3.6.1.4.1.37950.1.1.5.10.3.2.1.5.{N}   â†’ name STRING "EPON0/6:6"

  FDB / LAN-MAC learning table (one row per learned MAC):
    .1.3.6.1.4.1.37950.1.1.5.10.3.8.1.4.<MAC-as-6-decimals>  â†’ name STRING "EPON0/6:6"

  Optical per-ONU (P=port, N=onu_index):
    .1.3.6.1.4.1.37950.1.1.5.12.2.1.8.1.3.{P}.{N}   â†’ temperature Â°C
    .1.3.6.1.4.1.37950.1.1.5.12.2.1.8.1.4.{P}.{N}   â†’ voltage V
    .1.3.6.1.4.1.37950.1.1.5.12.2.1.8.1.5.{P}.{N}   â†’ tx_bias mA
    .1.3.6.1.4.1.37950.1.1.5.12.2.1.8.1.6.{P}.{N}   â†’ tx_power dBm
    .1.3.6.1.4.1.37950.1.1.5.12.2.1.8.1.7.{P}.{N}   â†’ rx_power "0.03 mW (-16.02 dBm)"

  Alarm:
    .1.3.6.1.4.1.37950.1.1.5.10.3.3.1.2.{N}   â†’ alarm code (26 = dying_gasp)
"""
from __future__ import annotations

import re
import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

from . import snmp_runner
from .types import OLTAdapter, OpticalData, Position

logger = logging.getLogger("rico_net.olt_engine.epon_100")


_NAME_RE = re.compile(r"EPON(\d+)/(\d+):(\d+)", re.IGNORECASE)


def _parse_epon_name(name: str) -> Optional[Position]:
    """'EPON0/6:6' â†’ Position(olt, '0/6', 6).  Returns None if unparseable."""
    if not name:
        return None
    m = _NAME_RE.search(name)
    if not m:
        return None
    chassis, port, idx = m.group(1), m.group(2), int(m.group(3))
    return Position(
        olt_host="10.10.10.100",
        pon_port=f"{chassis}/{port}",
        onu_index=idx,
    )


def _mac_from_decimal_suffix(oid: str) -> Optional[str]:
    """OID ending in 6 decimal numbers â†’ "AA:BB:CC:DD:EE:FF" (uppercase)."""
    parts = oid.strip(".").split(".")
    if len(parts) < 6:
        return None
    last6 = parts[-6:]
    try:
        nums = [int(p) for p in last6]
    except ValueError:
        return None
    if any(n < 0 or n > 255 for n in nums):
        return None
    return ":".join(f"{n:02X}" for n in nums)


def _last_oid_tail(oid: str) -> Optional[int]:
    """Return last numeric component of an OID."""
    parts = oid.strip(".").split(".")
    if not parts:
        return None
    try:
        return int(parts[-1])
    except ValueError:
        return None


class EponOLT100:
    """EPON .100 adapter implementing the OLTAdapter protocol."""

    olt_host = "10.10.10.100"

    BASE              = "1.3.6.1.4.1.37950.1.1"
    AUTH_MAC_COL      = f"{BASE}.5.10.3.2.1.3"   # ONU's optical MAC, indexed by OLT row N
    AUTH_STATUS_COL   = f"{BASE}.5.10.3.2.1.4"
    AUTH_NAME_COL     = f"{BASE}.5.10.3.2.1.5"   # "EPON0/6:6"
    AUTH_ALARM_COL    = f"{BASE}.5.10.3.3.1.2"

    FDB_NAME_COL      = f"{BASE}.5.10.3.8.1.4"   # learned MAC â†’ ONU name string

    OPTICAL_TEMP_COL  = f"{BASE}.5.12.2.1.8.1.3"
    OPTICAL_VOLT_COL  = f"{BASE}.5.12.2.1.8.1.4"
    OPTICAL_TXBIAS    = f"{BASE}.5.12.2.1.8.1.5"
    OPTICAL_TX_COL    = f"{BASE}.5.12.2.1.8.1.6"
    OPTICAL_RX_COL    = f"{BASE}.5.12.2.1.8.1.7"

    # â”€â”€â”€ auth table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    def walk_auth_table(self) -> Dict[str, Position]:
        """
        Walk all 3 columns (MAC, status, name), join by row-index N.
        Returns {optical_mac.upper(): Position}.
        """
        mac_rows: Dict[int, str] = {}
        for oid, val in snmp_runner.snmpbulkwalk(self.olt_host, self.AUTH_MAC_COL):
            n = _last_oid_tail(oid)
            mac = snmp_runner.parse_hex_string_value(val)
            if n is not None and mac:
                mac_rows[n] = mac.upper()

        name_rows: Dict[int, str] = {}
        for oid, val in snmp_runner.snmpbulkwalk(self.olt_host, self.AUTH_NAME_COL):
            n = _last_oid_tail(oid)
            name = snmp_runner.parse_string_value(val)
            if n is not None and name:
                name_rows[n] = name

        out: Dict[str, Position] = {}
        for n, mac in mac_rows.items():
            name = name_rows.get(n)
            pos = _parse_epon_name(name) if name else None
            if pos:
                out[mac] = pos
        return out

    def walk_auth_status(self) -> Dict[int, int]:
        """Row index N â†’ status INTEGER (1=online, 0=offline)."""
        out: Dict[int, int] = {}
        for oid, val in snmp_runner.snmpbulkwalk(self.olt_host, self.AUTH_STATUS_COL):
            n = _last_oid_tail(oid)
            i = snmp_runner.parse_integer_value(val)
            if n is not None and i is not None:
                out[n] = i
        return out

    def walk_auth_alarms(self) -> Dict[int, int]:
        """Row index N â†’ alarm code (26 = dying_gasp)."""
        out: Dict[int, int] = {}
        for oid, val in snmp_runner.snmpbulkwalk(self.olt_host, self.AUTH_ALARM_COL):
            n = _last_oid_tail(oid)
            i = snmp_runner.parse_integer_value(val)
            if n is not None and i is not None:
                out[n] = i
        return out

    # â”€â”€â”€ FDB table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    def walk_fdb_table(self) -> Dict[str, Position]:
        """
        Returns {learned_mac.upper(): Position}.
        MAC is encoded in the last 6 OID octets; value is the ONU name string.
        """
        out: Dict[str, Position] = {}
        for oid, val in snmp_runner.snmpbulkwalk(self.olt_host, self.FDB_NAME_COL):
            mac = _mac_from_decimal_suffix(oid)
            name = snmp_runner.parse_string_value(val)
            if not mac or not name:
                continue
            pos = _parse_epon_name(name)
            if pos:
                out[mac] = pos
        return out

    # â”€â”€â”€ optical table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    def walk_optical_table(self) -> Dict[Position, OpticalData]:
        """
        Walks 5 optical columns (rx, tx, temp, voltage, tx_bias), keys by Position.
        The OID suffix is `.1.{P}.{N}` where P is port number and N is onu_index.
        """
        now = datetime.now(timezone.utc)
        by_pos: Dict[Position, OpticalData] = {}

        def _get_position(oid: str) -> Optional[Position]:
            parts = oid.strip(".").split(".")
            if len(parts) < 2:
                return None
            try:
                p = parts[-2]
                n = int(parts[-1])
            except ValueError:
                return None
            return Position("10.10.10.100", f"0/{p}", n)

        for oid, val in snmp_runner.snmpbulkwalk(self.olt_host, self.OPTICAL_RX_COL):
            pos = _get_position(oid)
            if not pos:
                continue
            rx = snmp_runner.parse_rx_power(val)
            by_pos.setdefault(pos, OpticalData(polled_at=now)).rx_power_dbm = rx

        for oid, val in snmp_runner.snmpbulkwalk(self.olt_host, self.OPTICAL_TX_COL):
            pos = _get_position(oid)
            if not pos:
                continue
            tx = snmp_runner.parse_first_float(val)
            by_pos.setdefault(pos, OpticalData(polled_at=now)).tx_power_dbm = tx

        for oid, val in snmp_runner.snmpbulkwalk(self.olt_host, self.OPTICAL_TEMP_COL):
            pos = _get_position(oid)
            if not pos:
                continue
            t = snmp_runner.parse_first_float(val)
            by_pos.setdefault(pos, OpticalData(polled_at=now)).temperature_c = t

        for oid, val in snmp_runner.snmpbulkwalk(self.olt_host, self.OPTICAL_VOLT_COL):
            pos = _get_position(oid)
            if not pos:
                continue
            v = snmp_runner.parse_first_float(val)
            if v is not None:
                by_pos.setdefault(pos, OpticalData(polled_at=now)).voltage_mv = int(v * 1000)

        for oid, val in snmp_runner.snmpbulkwalk(self.olt_host, self.OPTICAL_TXBIAS):
            pos = _get_position(oid)
            if not pos:
                continue
            b = snmp_runner.parse_first_float(val)
            by_pos.setdefault(pos, OpticalData(polled_at=now)).tx_bias_ma = b

        return by_pos

    def get_position_live(self, port: str, idx: int) -> Optional[OpticalData]:
        """
        Single-shot SNMP GET for one ONU's optical data.
        `port` like "0/6" â€” strip the chassis to get '6' (last component).
        """
        try:
            p = port.split("/")[-1]
            int(p)
        except (ValueError, IndexError):
            return None

        now = datetime.now(timezone.utc)
        data = OpticalData(polled_at=now)

        rx_raw = snmp_runner.snmpget(self.olt_host, f"{self.OPTICAL_RX_COL}.1.{p}.{idx}")
        if rx_raw:
            data.rx_power_dbm = snmp_runner.parse_rx_power(rx_raw)

        tx_raw = snmp_runner.snmpget(self.olt_host, f"{self.OPTICAL_TX_COL}.1.{p}.{idx}")
        if tx_raw:
            data.tx_power_dbm = snmp_runner.parse_first_float(tx_raw)

        temp_raw = snmp_runner.snmpget(self.olt_host, f"{self.OPTICAL_TEMP_COL}.1.{p}.{idx}")
        if temp_raw:
            data.temperature_c = snmp_runner.parse_first_float(temp_raw)

        return data if data.rx_power_dbm is not None else None
