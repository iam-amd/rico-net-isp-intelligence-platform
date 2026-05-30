"""Shared types for OLT engine adapters."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional, Protocol, Tuple


# A physical ONU slot on an OLT.
@dataclass(frozen=True)
class Position:
    olt_host: str        # e.g. "10.10.10.100"
    pon_port: str        # e.g. "0/6"
    onu_index: int       # e.g. 6

    def __str__(self) -> str:
        return f"{self.olt_host} {self.pon_port}/{self.onu_index}"


@dataclass
class OpticalData:
    rx_power_dbm: Optional[float] = None
    tx_power_dbm: Optional[float] = None
    temperature_c: Optional[float] = None
    voltage_mv: Optional[int] = None
    tx_bias_ma: Optional[float] = None
    status: Optional[str] = None              # "online" | "offline"
    dying_gasp: bool = False
    alarm_code: Optional[int] = None          # 26 = dying gasp on EPON
    polled_at: Optional[datetime] = None


@dataclass
class CustomerDNARecord:
    """A fully-resolved customer record â€” composed from Railwire + OLT data.

    `binding_source` values:
      sticker_scan   â€” sticker-captured optical MAC matches an auth MAC (truth)
      fdb_match      â€” Railwire MAC found in OLT FDB â†’ position known
      offset_match   â€” closest ONU on same /40 prefix (off-by-N)
      no_olt_match   â€” engine has no position for this customer
    """
    username: str
    railwire_mac: Optional[str] = None
    sticker_optical_mac: Optional[str] = None
    sticker_serial: Optional[str] = None
    router_mac: Optional[str] = None

    position: Optional[Position] = None
    optical_mac: Optional[str] = None
    optical_serial: Optional[str] = None

    binding_source: str = "no_olt_match"
    confidence: str = "guess"                 # verified | probable | guess
    railwire_to_optical_offset: Optional[int] = None

    live: OpticalData = field(default_factory=OpticalData)

    notes: List[str] = field(default_factory=list)


@dataclass
class BootstrapReport:
    olt_host: str
    customers_total: int = 0
    customers_with_railwire_mac: int = 0
    auth_table_entries: int = 0
    fdb_table_entries: int = 0
    optical_table_entries: int = 0

    resolved_sticker_scan: int = 0
    resolved_auth_direct: int = 0
    resolved_fdb_match: int = 0
    resolved_offset_match: int = 0
    resolved_no_olt_match: int = 0

    records: List[CustomerDNARecord] = field(default_factory=list)
    duration_seconds: float = 0.0


class OLTAdapter(Protocol):
    """Every OLT adapter implements this interface â€” the engine doesn't care
    which physical OLT it talks to."""

    olt_host: str

    def walk_auth_table(self) -> Dict[str, Position]:
        """Map optical MAC â†’ its Position (port, idx). One walk per OLT."""
        ...

    def walk_fdb_table(self) -> Dict[str, Position]:
        """Map every learned MAC (incl. Railwire WAN MACs) â†’ Position."""
        ...

    def walk_optical_table(self) -> Dict[Position, OpticalData]:
        """Map Position â†’ current rx/tx/temp/voltage/status snapshot."""
        ...

    def get_position_live(self, port: str, idx: int) -> Optional[OpticalData]:
        """Single SNMP GET for one ONU â€” for /live endpoint."""
        ...
