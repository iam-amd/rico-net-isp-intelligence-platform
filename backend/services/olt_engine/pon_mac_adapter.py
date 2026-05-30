"""
Universal PON MAC Table adapter â€” implements the user's manual 2-step procedure.

Step 1 (PON MAC Table walk):
    For every learned MAC on the OLT, get its ONU position (Pon:Onu).
    All 3 OLTs expose this table â€” only OID, position column, and value format differ.

Step 2 (ONU table walk):
    For every Pon:Onu position, get the ONU's own identifier (device MAC or serial).

Discovered 2026-05-20 via SNMP cross-verification against OLT web UI:

  | OLT    | PON MAC Table        | Pos column | Format        | Index style       |
  |--------|----------------------|------------|---------------|-------------------|
  | .100   | .5.10.3.8.1          | col 4      | EPON0/X:Y     | .6.{MAC 6 bytes}  |
  | .200   | .5.10.3.5.1          | col 5      | X:Y           | .{row int}        |
  | .210   | .5.10.3.12.1         | col 4      | PONX:ONUY     | .6.{MAC 6 bytes}  |

The "GPON port" is normalized to "0/X" in `Position.pon_port`.
"""
from __future__ import annotations

import re
import logging
from typing import Dict, Optional

from . import snmp_runner
from .types import Position

logger = logging.getLogger("rico_net.olt_engine.pon_mac")


# â”€â”€â”€ parsers for the 3 position string formats â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

_RE_EPON  = re.compile(r"EPON(\d+)/(\d+):(\d+)",      re.IGNORECASE)   # "EPON0/6:6"
_RE_GPON  = re.compile(r"PON(\d+):ONU(\d+)",           re.IGNORECASE)   # "PON4:ONU50"
_RE_PAIR  = re.compile(r"^(\d{1,2}):(\d{1,3})$")                       # "2:9"
_RE_BAREN = re.compile(r"^(\d+)$")                                     # bare number fallback


def parse_position(value: str, olt_host: str) -> Optional[Position]:
    if not value:
        return None
    s = value.strip().strip('"')

    m = _RE_EPON.search(s)
    if m:
        return Position(olt_host, f"{m.group(1)}/{m.group(2)}", int(m.group(3)))

    m = _RE_GPON.search(s)
    if m:
        return Position(olt_host, f"0/{m.group(1)}", int(m.group(2)))

    m = _RE_PAIR.match(s)
    if m:
        return Position(olt_host, f"0/{m.group(1)}", int(m.group(2)))

    return None


# â”€â”€â”€ universal adapter â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

class PonMacAdapter:
    """One adapter, parameterized per OLT."""

    def __init__(
        self,
        *,
        olt_host: str,
        table_oid: str,
        position_col: int,
        mac_col: int,
        mac_indexed_by_oid: bool,       # True for .100/.210, False for .200
        timeout: int = 60,
        snmp_timeout: int | None = None,
        snmp_chunk: int | None = None,
        empty_retry: bool = False,
    ):
        self.olt_host           = olt_host
        self.table_oid          = table_oid
        self.position_col       = position_col
        self.mac_col            = mac_col
        self.mac_indexed_by_oid = mac_indexed_by_oid
        self.timeout            = timeout
        self.snmp_timeout       = snmp_timeout
        self.snmp_chunk         = snmp_chunk
        self.empty_retry        = empty_retry

    # â”€â”€â”€ Step 1 â€” PON MAC Table walk â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    def walk_pon_mac_table(self) -> Dict[str, Position]:
        """Returns {MAC: Position} â€” the one canonical mapping per OLT.

        For .100/.210: MAC is in the OID suffix (.6.<6 decimal bytes>).
        For .200: MAC is the value at row index N (col 3).
        Position is always at `position_col` of the same row.

        Aggregation-slot filter: when a slot has more than
        AGGREGATION_SLOT_THRESHOLD distinct MACs (default 5), it's a
        backbone/uplink interface that learned LAN MACs of devices
        behind real ONUs â€” not an actual customer slot. We drop ALL
        entries at such slots so the engine doesn't bind customers to
        the uplink. (Verified case: 10.10.10.200 0/1/4 had 90 MACs.)
        """
        raw_pairs: list[tuple[str, Position]] = self._walk_raw()
        return self._filter_aggregation_slots(raw_pairs)

    def _walk_raw(self) -> list[tuple[str, Position]]:
        """Pure SNMP walk â†’ list of (MAC, Position) pairs. No filtering."""
        pairs: list[tuple[str, Position]] = []

        if self.mac_indexed_by_oid:
            pos_walk = snmp_runner.snmpbulkwalk(
                self.olt_host, f"{self.table_oid}.{self.position_col}", timeout=self.timeout,
                snmp_timeout=self.snmp_timeout, snmp_chunk=self.snmp_chunk,
                empty_retry=self.empty_retry,
            )
            for oid, val in pos_walk:
                mac = self._mac_from_oid_suffix(oid)
                if not mac:
                    continue
                position_str = snmp_runner.parse_string_value(val)
                if not position_str:
                    continue
                pos = parse_position(position_str, self.olt_host)
                if pos:
                    pairs.append((mac.upper(), pos))
            return pairs

        # .200-style: walk MAC col + position col, join on row index
        mac_by_row: Dict[str, str] = {}
        for oid, val in snmp_runner.snmpbulkwalk(
            self.olt_host, f"{self.table_oid}.{self.mac_col}",
            timeout=self.timeout, snmp_timeout=self.snmp_timeout,
            snmp_chunk=self.snmp_chunk, empty_retry=self.empty_retry,
        ):
            row = oid.strip(".").split(".")[-1]
            mac_str = snmp_runner.parse_string_value(val)
            if mac_str:
                m = mac_str.strip().strip('"').upper().replace("-", ":").replace(".", ":")
                if len(m) == 17 and m.count(":") == 5:
                    mac_by_row[row] = m

        pos_by_row: Dict[str, Position] = {}
        for oid, val in snmp_runner.snmpbulkwalk(
            self.olt_host, f"{self.table_oid}.{self.position_col}",
            timeout=self.timeout, snmp_timeout=self.snmp_timeout,
            snmp_chunk=self.snmp_chunk, empty_retry=self.empty_retry,
        ):
            row = oid.strip(".").split(".")[-1]
            position_str = snmp_runner.parse_string_value(val)
            if position_str:
                p = parse_position(position_str, self.olt_host)
                if p:
                    pos_by_row[row] = p

        for row, mac in mac_by_row.items():
            pos = pos_by_row.get(row)
            if pos:
                pairs.append((mac, pos))
        return pairs

    AGGREGATION_SLOT_THRESHOLD = 5

    def _filter_aggregation_slots(
        self, pairs: list[tuple[str, Position]]
    ) -> Dict[str, Position]:
        """Drop entire slots that hold more than N MACs.

        A real customer slot has ONE ONU (1 MAC). A slot holding many MACs
        is an uplink/aggregation/bridge interface â€” its MACs are LAN-learned
        downstream devices, not the slot's actual ONU.

        We also dedup MACs that appear at MULTIPLE kept slots: keep the
        first stable entry (the rest are echoes from MAC-learning on other
        ports). The engine's tie-break by Rx will refine further on the
        next pass after we have optical data.
        """
        # Count MACs per slot
        slot_counts: Dict[Position, int] = {}
        for _, pos in pairs:
            slot_counts[pos] = slot_counts.get(pos, 0) + 1

        bad_slots = {pos for pos, cnt in slot_counts.items()
                     if cnt > self.AGGREGATION_SLOT_THRESHOLD}
        if bad_slots:
            import logging
            log = logging.getLogger(__name__)
            for pos in sorted(bad_slots, key=lambda p: (p.pon_port, p.onu_index)):
                log.warning(
                    "AGGREGATION SLOT FILTERED: %s %s/%s has %d MACs (threshold %d) â€” likely uplink, dropping all entries",
                    self.olt_host, pos.pon_port, pos.onu_index,
                    slot_counts[pos], self.AGGREGATION_SLOT_THRESHOLD,
                )

        # Build {MAC: Position}, skipping aggregation slots.
        # If the same MAC appears at multiple kept slots, keep the FIRST
        # we encounter (deterministic by iteration order); the engine's
        # faÃ§ade has secondary tie-break logic when optical data is present.
        out: Dict[str, Position] = {}
        for mac, pos in pairs:
            if pos in bad_slots:
                continue
            if mac not in out:
                out[mac] = pos
        return out

    # â”€â”€â”€ helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    @staticmethod
    def _mac_from_oid_suffix(oid: str) -> Optional[str]:
        """OID ending in '.6.<6 decimal bytes>' â†’ 'AA:BB:CC:DD:EE:FF'."""
        parts = oid.strip(".").split(".")
        if len(parts) < 7:
            return None
        last6 = parts[-6:]
        try:
            nums = [int(p) for p in last6]
        except ValueError:
            return None
        if any(n < 0 or n > 255 for n in nums):
            return None
        return ":".join(f"{n:02X}" for n in nums)


# â”€â”€â”€ factory â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

# Fallback bundles used ONLY when the olt_registry cache is cold AND a caller
# bypasses the engine faÃ§ade (which is the cache-priming entry point). Keeping
# these around means startup races + ad-hoc scripts still get the right OIDs.
_LEGACY_FALLBACK = {
    "10.10.10.100": dict(
        table_oid          = "1.3.6.1.4.1.37950.1.1.5.10.3.8.1",
        position_col       = 4, mac_col = 1, mac_indexed_by_oid = True,
        timeout            = 90, snmp_timeout = 5, snmp_chunk = 50, empty_retry = False,
    ),
    "10.10.10.200": dict(
        table_oid          = "1.3.6.1.4.1.37950.1.1.5.10.3.5.1",
        position_col       = 5, mac_col = 3, mac_indexed_by_oid = False,
        timeout            = 90, snmp_timeout = 5, snmp_chunk = 50, empty_retry = False,
    ),
    "10.10.10.210": dict(
        table_oid          = "1.3.6.1.4.1.37950.1.1.5.10.3.12.1",
        position_col       = 4, mac_col = 1, mac_indexed_by_oid = True,
        timeout            = 300, snmp_timeout = 30, snmp_chunk = 10, empty_retry = True,
    ),
}


def get_pon_mac_adapter(olt_host: str) -> Optional[PonMacAdapter]:
    # Prefer registry (DB-driven). Cache is primed by the engine faÃ§ade at
    # start of every reconcile cycle.
    try:
        from backend.services import olt_registry  # avoid circular import at module load
    except Exception:
        olt_registry = None  # type: ignore

    cfg = olt_registry.peek(olt_host) if olt_registry else None
    if cfg and cfg.pon_mac_table_oid and cfg.pon_mac_position_col and cfg.pon_mac_col:
        return PonMacAdapter(
            olt_host           = cfg.host,
            table_oid          = cfg.pon_mac_table_oid,
            position_col       = cfg.pon_mac_position_col,
            mac_col            = cfg.pon_mac_col,
            mac_indexed_by_oid = cfg.pon_mac_indexed_by_oid,
            timeout            = cfg.walk_timeout_sec,
            snmp_timeout       = cfg.snmp_timeout_sec,
            snmp_chunk         = cfg.snmp_chunk,
            empty_retry        = cfg.empty_retry,
        )

    # Fallback to bundled defaults so legacy scripts (verifier, probes) still work.
    fb = _LEGACY_FALLBACK.get(olt_host)
    if not fb:
        return None
    return PonMacAdapter(olt_host=olt_host, **fb)


def get_all_olt_hosts() -> list[str]:
    """Cache-only host list. Engine faÃ§ade primes the cache before iterating."""
    try:
        from backend.services import olt_registry
        hosts = olt_registry.peek_all_hosts()
        if hosts:
            return hosts
    except Exception:
        pass
    # Fallback to the 3 known OLTs so scripts that don't go through the faÃ§ade work.
    return ["10.10.10.100", "10.10.10.200", "10.10.10.210"]


# Backward-compat module attribute. New callers should use get_all_olt_hosts().
# We intentionally re-evaluate via __getattr__ so the value is always fresh.
def __getattr__(name):
    if name == "ALL_OLT_HOSTS":
        return get_all_olt_hosts()
    raise AttributeError(name)
