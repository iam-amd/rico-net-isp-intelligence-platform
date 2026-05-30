"""
OLT Engine — unified per-customer realtime + identity layer.

Per the master plan (finalplan/15_OLT_ENGINE_MASTER.md):

  Layer 2 — per-OLT adapters (epon_100, gpon_200, gpon_210)
  Layer 3 — unified façade (this package)

Each adapter implements the same interface (see types.OLTAdapter). The
façade routes by `olt_host`.

Bootstrap order (one OLT at a time): EPON .100 → GPON .210 → GPON .200.
"""
from .types import (
    Position,
    OpticalData,
    OLTAdapter,
    CustomerDNARecord,
    BootstrapReport,
)
from .facade import (
    reconcile_all,
    resolve_one,
    get_dna,
    get_status_summary,
    get_recent_runs,
    get_recent_changes,
    get_orphan_onus,
    optical_adapter_for,
)

__all__ = [
    "Position",
    "OpticalData",
    "OLTAdapter",
    "CustomerDNARecord",
    "BootstrapReport",
    "reconcile_all",
    "resolve_one",
    "get_dna",
    "get_status_summary",
    "get_recent_runs",
    "get_recent_changes",
    "get_orphan_onus",
    "optical_adapter_for",
]
