"""
GPON .200 adapter (Netlink V1600G1, firmware V2.3.1R).

âš ï¸ LIMITATION discovered 2026-05-20:
  ifPhysAddress for GPON ONU interfaces returns 00:00:00:00:00:00 â€” the OLT
  does NOT expose ONU optical MACs via standard SNMP. Position + optical
  signal work fine; MAC mapping does not.

  Auto-binding by Railwire MAC is therefore NOT POSSIBLE on .200 via SNMP.
  Three paths forward (any one fixes a customer):
    1. Sticker scan + serial â†’ match against `.6.1.1.4` serial column.
    2. Telnet fallback: `show mac-address-table` parses LAN-MAC table.
    3. Mark customer needing physical survey.

What IS exposed via SNMP on .200:
  ifDescr        .1.3.6.1.2.1.2.2.1.2.{idx}    "GPON01ONU7" â†’ port+index
  Phase          .5.{P}.{N}      (3=working, 4=DyingGasp, 5=offline, 6=AuthFail)
  RX power       .7.{P}.{N}      "-12.234(dBm)"
  TX power       .6.{P}.{N}
  OLT-side RX    .8.{P}.{N}      (more reliable measurement)
"""
from __future__ import annotations

import re
import logging
from datetime import datetime, timezone
from typing import Dict, Optional

from . import snmp_runner
from .types import OpticalData, Position

logger = logging.getLogger("rico_net.olt_engine.gpon_200")


_GPON_NAME_RE = re.compile(r"GPON0?(\d+)ONU(\d+)", re.IGNORECASE)


def _parse_gpon_name(name: str) -> Optional[Position]:
    m = _GPON_NAME_RE.search(name or "")
    if not m:
        return None
    return Position("10.10.10.200", f"0/{int(m.group(1))}", int(m.group(2)))


def _last_oid_tail(oid: str) -> Optional[int]:
    parts = oid.strip(".").split(".")
    try:
        return int(parts[-1])
    except (ValueError, IndexError):
        return None


class GponOLT200:
    olt_host = "10.10.10.200"

    IF_DESCR     = "1.3.6.1.2.1.2.2.1.2"

    BASE = "1.3.6.1.4.1.37950.1.1"
    PHASE_COL    = f"{BASE}.6.1.1.1.1.5"
    OPTICAL_TX   = f"{BASE}.6.1.1.3.1.6"
    OPTICAL_RX   = f"{BASE}.6.1.1.3.1.7"
    OPTICAL_OLT_RX = f"{BASE}.6.1.1.3.1.8"

    def walk_auth_table(self) -> Dict[str, Position]:
        """Returns empty dict â€” GPON .200 ifPhysAddress is zeroed.
        MAC-based binding requires Telnet fallback (not in scope of Step 3)."""
        logger.warning("GPON .200 does not expose ONU MAC via SNMP â€” auth_table is empty")
        return {}

    def walk_fdb_table(self) -> Dict[str, Position]:
        """No SNMP FDB on .200 (BRIDGE-MIB has 2 uplink-only entries)."""
        return {}

    def walk_position_only(self) -> Dict[Position, str]:
        """Walk ifDescr â†’ {Position: ifDescr_string}. Used so .200 customers
        with an existing binding can still get live signal lookup."""
        out: Dict[Position, str] = {}
        for oid, val in snmp_runner.snmpbulkwalk(self.olt_host, self.IF_DESCR, timeout=60):
            s = snmp_runner.parse_string_value(val)
            if not s:
                continue
            pos = _parse_gpon_name(s)
            if pos:
                out[pos] = s
        return out

    def walk_optical_table(self) -> Dict[Position, OpticalData]:
        now = datetime.now(timezone.utc)
        by_pos: Dict[Position, OpticalData] = {}

        def _pos_from_suffix(oid: str) -> Optional[Position]:
            parts = oid.strip(".").split(".")
            if len(parts) < 2: return None
            try:
                p = parts[-2]; n = int(parts[-1]); int(p)
                return Position("10.10.10.200", f"0/{p}", n)
            except ValueError:
                return None

        for oid, val in snmp_runner.snmpbulkwalk(self.olt_host, self.OPTICAL_RX, timeout=60):
            pos = _pos_from_suffix(oid)
            if not pos: continue
            s = (snmp_runner.parse_string_value(val) or val).replace("(dBm)", "").strip()
            try: rx = float(s)
            except ValueError: rx = None
            by_pos.setdefault(pos, OpticalData(polled_at=now)).rx_power_dbm = rx

        for oid, val in snmp_runner.snmpbulkwalk(self.olt_host, self.OPTICAL_TX, timeout=60):
            pos = _pos_from_suffix(oid)
            if not pos: continue
            s = (snmp_runner.parse_string_value(val) or val).replace("(dBm)", "").strip()
            try: tx = float(s)
            except ValueError: tx = None
            by_pos.setdefault(pos, OpticalData(polled_at=now)).tx_power_dbm = tx

        for oid, val in snmp_runner.snmpbulkwalk(self.olt_host, self.PHASE_COL, timeout=60):
            pos = _pos_from_suffix(oid)
            if not pos: continue
            phase = snmp_runner.parse_integer_value(val)
            data = by_pos.setdefault(pos, OpticalData(polled_at=now))
            if phase == 3: data.status = "online"
            elif phase == 4: data.status = "offline"; data.dying_gasp = True
            elif phase in (5, 6): data.status = "offline"

        return by_pos

    def get_position_live(self, port: str, idx: int) -> Optional[OpticalData]:
        try:
            p = port.split("/")[-1]; int(p)
        except (ValueError, IndexError):
            return None

        now = datetime.now(timezone.utc)
        data = OpticalData(polled_at=now)

        rx_raw = snmp_runner.snmpget(self.olt_host, f"{self.OPTICAL_RX}.{p}.{idx}")
        if rx_raw:
            s = (snmp_runner.parse_string_value(rx_raw) or rx_raw).replace("(dBm)", "").strip()
            try: data.rx_power_dbm = float(s)
            except ValueError: pass

        return data if data.rx_power_dbm is not None else None
