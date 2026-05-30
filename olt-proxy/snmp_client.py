"""
OLT SNMP Client Ã¢â‚¬â€ Rico Net
Hardcoded OID paths confirmed from live data on all 3 OLTs.
No profile JSON required.

EPON .100  : enterprise ONU table (MAC/status/name) + enterprise optical
GPON .200/.210 : ifTable (MAC/status) + enterprise GPON optical + dying_gasp

Returns the same dict structure as olt_client.get_all_onus() for drop-in use.
"""

import logging
import json
import os
import re
import time
from typing import Any, Dict, List, Optional, Tuple

from snmp_walk_raw import get as _raw_get, walk as _raw_walk, snmp_set_int as _snmp_set_int
from config import SNMP_COMMUNITY_READ, SNMP_COMMUNITY_WRITE, SNMP_PORT

logger = logging.getLogger(__name__)
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_GPON_INVENTORY_CACHE = os.path.join(_SCRIPT_DIR, ".gpon_inventory_cache.json")

# =============================================================================
# CONFIRMED OID CONSTANTS
# =============================================================================

_ENT = "1.3.6.1.4.1.37950"   # Netlink enterprise root (CTB/VSOL shared chipset)

# Ã¢â€â‚¬Ã¢â€â‚¬ EPON (.100) ONU registration table Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
# Indexed by sequential ONU number N (global, not port-local)
_E_ONU_MAC    = _ENT + ".1.1.5.10.3.2.1.3"   # Hex-STRING MAC
_E_ONU_STAT   = _ENT + ".1.1.5.10.3.2.1.4"   # INTEGER: 1=online, 0=offline
_E_ONU_NAME   = _ENT + ".1.1.5.10.3.2.1.5"   # STRING: "EPON0/1:7"
_E_ALARM      = _ENT + ".1.1.5.10.3.3.1.2"   # INTEGER: 0=no alarm, 26=dying_gasp
_E_DG_IDX     = 26                            # alarm string index 26 = "onu-dying-gasp"

# Ã¢â€â‚¬Ã¢â€â‚¬ EPON optical Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
# Indexed by {COL}.{PORT}.{ONU}  e.g. .7.1.5 = RX of port 1 ONU 5
_E_OPT        = _ENT + ".1.1.5.12.2.1.8.1"
_E_OPT_TEMP   = _E_OPT + ".3"   # temperature Ã‚Â°C
_E_OPT_VOLT   = _E_OPT + ".4"   # voltage V
_E_OPT_BIAS   = _E_OPT + ".5"   # TX bias mA
_E_OPT_TX     = _E_OPT + ".6"   # TX power dBm  e.g. "1.87 mW (2.72 dBm)"
_E_OPT_RX     = _E_OPT + ".7"   # RX power dBm  e.g. "0.03 mW (-16.02 dBm)"

# Ã¢â€â‚¬Ã¢â€â‚¬ GPON (.200/.210) phase/dying_gasp Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
# Indexed by {PORT}.{ONU}   3=Working, 4=DyingGasp, 5=Offline, 6=AuthFail
_G_ONU_MAC    = _ENT + ".1.1.5.10.3.5.1.3"   # GPON optical MAC/string, indexed by global N
_G_ONU_NAME   = _ENT + ".1.1.5.10.3.5.1.5"   # GPON "port:onu_idx", indexed by global N
_G_STATUS     = _ENT + ".1.1.6.1.1.1.1.4"     # 1=online, 2=offline, indexed by P.O
_G_PHASE      = _ENT + ".1.1.6.1.1.1.1.5"

# Ã¢â€â‚¬Ã¢â€â‚¬ GPON optical Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
# Indexed by {COL}.{PORT}.{ONU}
_G_OPT        = _ENT + ".1.1.6.1.1.3.1"
_G_OPT_TEMP   = _G_OPT + ".3"   # temperature
_G_OPT_VOLT   = _G_OPT + ".4"   # voltage
_G_OPT_BIAS   = _G_OPT + ".5"   # TX bias
_G_OPT_TX     = _G_OPT + ".6"   # TX power  e.g. "2.294(dBm)"
_G_OPT_RX     = _G_OPT + ".7"   # RX power  e.g. "-13.518(dBm)" or "-23.87"
_G_OPT_OLT    = _G_OPT + ".8"   # OLT-side RX (more reliable measurement)

# Ã¢â€â‚¬Ã¢â€â‚¬ ifTable standard MIBs (used for GPON MAC / status / traffic) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
_IF_DESCR     = "1.3.6.1.2.1.2.2.1.2"    # GPON01ONU7
_IF_MAC       = "1.3.6.1.2.1.2.2.1.6"    # Hex-STRING MAC
_IF_STATUS    = "1.3.6.1.2.1.2.2.1.8"    # 1=up, 2=down
_IF_IN        = "1.3.6.1.2.1.2.2.1.10"   # ifInOctets
_IF_OUT       = "1.3.6.1.2.1.2.2.1.16"   # ifOutOctets

# LAN-side MAC learning tables. Railwire stores the customer/router LAN MAC,
# while the ONU inventory table stores the optical ONU MAC.
_E_LAN_MAC_TO_ONU = _ENT + ".1.1.5.10.3.8.1.4"      # index: MAC dec, value: EPON0/P:O
_G210_LAN_MAC     = _ENT + ".1.1.5.10.3.12.1.1.6"   # index: MAC dec, value: MAC bytes

# Ã¢â€â‚¬Ã¢â€â‚¬ SNMP SET reboot OID (unconfirmed Ã¢â‚¬â€ write-only so absent from walks) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
# Research: .1.1.5.10.3.1.2.1.10.{N} = INTEGER 1 triggers EPON ONU reboot
# GPON reboot OID not yet identified
_E_REBOOT     = _ENT + ".1.1.5.10.3.1.2.1.10"   # EPON: SET {N} = 1
_REBOOT_VAL   = 1                                  # trigger value (try 1; if fails try 3)

# Ã¢â€â‚¬Ã¢â€â‚¬ Per-OLT SNMP timeout (V1.4.8R on .210 is slow) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
_TIMEOUT = {
    "10.10.10.100": 15,
    "10.10.10.200": 15,
    "10.10.10.210": 60,
}
_TIMEOUT_DEFAULT = 15

# Regex patterns
_EPON_NAME_RE  = re.compile(r"EPON0?/(\d+):(\d+)", re.IGNORECASE)
_GPON_DESCR_RE = re.compile(r"GPON(\d{1,2})ONU(\d+)", re.IGNORECASE)
_GPON_NAME_RE  = re.compile(r"(?:GPON)?0?/?(\d+)[:/](\d+)", re.IGNORECASE)


# =============================================================================
# LOW-LEVEL HELPERS
# =============================================================================

def _walk(host: str, oid: str, timeout: int = _TIMEOUT_DEFAULT, max_reps: int = 50) -> List[Tuple]:
    try:
        return _raw_walk(host, community=SNMP_COMMUNITY_READ,
                         start_oid=oid, port=SNMP_PORT, timeout=timeout, max_reps=max_reps)
    except Exception as exc:
        logger.warning("SNMP walk %s @ %s: %s", oid, host, exc)
        return []


def _build_map(rows: List[Tuple], prefix: str) -> Dict[str, Any]:
    """Map OID suffix Ã¢â€ â€™ value for a walked column."""
    m: Dict[str, Any] = {}
    plen = len(prefix)
    for oid, _t, v in rows:
        if oid.startswith(prefix):
            suffix = oid[plen:].lstrip(".")
            m[suffix] = v
    return m


def _parse_mac(v: Any) -> Optional[str]:
    s = str(v).replace(":", "").replace("-", "").replace(" ", "").upper()
    if len(s) == 12 and re.fullmatch(r"[0-9A-F]{12}", s):
        if s in ("000000000000", "FFFFFFFFFFFF"):
            return None
        if int(s[0:2], 16) & 1:   # multicast
            return None
        return ":".join(s[i:i+2] for i in range(0, 12, 2))
    return None


def _mac_oid_suffix(mac: Any) -> Optional[str]:
    """Convert a MAC into the decimal OID suffix used by Netlink LAN tables."""
    parsed = _parse_mac(mac)
    if not parsed:
        return None
    return ".".join(str(int(part, 16)) for part in parsed.split(":"))


def _get_value(host: str, oid: str, timeout: int = _TIMEOUT_DEFAULT) -> Optional[Any]:
    try:
        row = _raw_get(host, community=SNMP_COMMUNITY_READ, oid=oid,
                       port=SNMP_PORT, timeout=timeout)
    except Exception as exc:
        logger.warning("SNMP get %s @ %s: %s", oid, host, exc)
        return None
    if not row:
        return None
    _oid, _t, value = row
    return value


def _parse_epon_lan_placement(value: Any) -> Optional[Tuple[str, Optional[int]]]:
    """Parse EPON LAN table values like 'EPON0/6:7' into ('0/6', 7), or 'PON1' into ('0/1', None)."""
    match = _EPON_NAME_RE.search(str(value))
    if match:
        try:
            port = int(match.group(1))
            onu_index = int(match.group(2))
            return f"0/{port}", onu_index
        except (TypeError, ValueError):
            return None
    
    # Fallback to physical PON port names (e.g. "PON1")
    match_phys = re.search(r"PON(\d+)", str(value), re.IGNORECASE)
    if match_phys:
        try:
            port = int(match_phys.group(1))
            return f"0/{port}", None
        except (TypeError, ValueError):
            return None
    return None


def lookup_lan_mac(olt_host: str, lan_mac: str) -> Dict[str, Any]:
    """
    Exact SNMP lookup for a Railwire/customer LAN MAC.

    The function is deliberately conservative:
    - .100 can confirm both MAC and ONU slot from one exact GET.
    - .210 can confirm MAC presence, but placement is not trusted until the
      sibling join column is verified in live research.
    - .200 has no discovered LAN-MAC table, so survey binding remains required.
    """
    mac = _parse_mac(lan_mac)
    suffix = _mac_oid_suffix(lan_mac)
    base = {
        "olt_host": olt_host,
        "lan_mac": mac,
        "supported": False,
        "confidence": "unknown",
        "match_method": "unsupported",
        "placement_confirmed": False,
        "pon_port": None,
        "onu_index": None,
        "reason": None,
    }
    if not mac or not suffix:
        return {**base, "reason": "Invalid LAN MAC address."}

    timeout = _TIMEOUT.get(olt_host, _TIMEOUT_DEFAULT)
    if olt_host == "10.10.10.100":
        # EPON OLT table requires a variable-length string length prefix '6.' in the OID
        value = _get_value(olt_host, f"{_E_LAN_MAC_TO_ONU}.6.{suffix}", timeout)
        placement = _parse_epon_lan_placement(value) if value is not None else None
        if not placement:
            return {
                **base,
                "supported": True,
                "match_method": "epon_lan_mac_exact_get",
                "reason": "MAC not found in EPON LAN-MAC table.",
            }
        pon_port, onu_index = placement
        return {
            **base,
            "supported": True,
            "confidence": "confirmed" if onu_index is not None else "probable_port",
            "match_method": "epon_lan_mac_exact_get",
            "placement_confirmed": onu_index is not None,
            "pon_port": pon_port,
            "onu_index": onu_index,
            "reason": "LAN MAC matched the EPON OLT learning table exactly on port." if onu_index is None else "LAN MAC matched the EPON OLT learning table exactly.",
        }

    if olt_host == "10.10.10.210":
        value = _get_value(olt_host, f"{_G210_LAN_MAC}.{suffix}", timeout)
        found_mac = _parse_mac(value)
        if found_mac != mac:
            return {
                **base,
                "supported": True,
                "match_method": "gpon210_lan_mac_exact_get",
                "reason": "MAC not found in GPON .210 LAN-MAC table.",
            }
        return {
            **base,
            "supported": True,
            "confidence": "confirmed_presence",
            "match_method": "gpon210_lan_mac_exact_get",
            "reason": (
                "LAN MAC exists on GPON .210, but the ONU placement join column "
                "is not yet verified; survey/admin binding is still required."
            ),
        }

    if olt_host == "10.10.10.200":
        return {
            **base,
            "match_method": "survey_required",
            "reason": "GPON .200 has no discovered LAN-MAC SNMP table.",
        }

    return {**base, "reason": "Unknown OLT host; no LAN-MAC capability profile."}


def _parse_epon_rx(v: Any) -> Optional[float]:
    """Parse EPON RX: '0.03 mW (-16.02 dBm)' Ã¢â€ â€™ -16.02"""
    m = re.search(r"\((-?[\d.]+)\s*dBm\)", str(v))
    if m:
        try:
            return float(m.group(1))
        except ValueError:
            pass
    return None


def _parse_epon_opt_simple(v: Any) -> Optional[float]:
    """Parse simple EPON optical values like temperature '33', voltage '3.29'."""
    s = str(v).strip()
    try:
        return float(s)
    except (ValueError, TypeError):
        return None


def _parse_gpon_dbm(v: Any) -> Optional[float]:
    """Parse GPON dBm strings: '-13.518(dBm)', '2.294(dBm)', '-23.87', 'N/A'"""
    s = str(v).replace("(dBm)", "").replace("dBm", "").strip()
    if s.lower() in ("n/a", "", "none", "-"):
        return None
    try:
        return float(s)
    except (ValueError, TypeError):
        return None


def _parse_gpon_name(v: Any) -> Optional[Tuple[int, int]]:
    """Parse GPON placement strings such as '1:7', '0/1:7', or 'GPON0/1:7'."""
    m = _GPON_NAME_RE.search(str(v).strip())
    if not m:
        return None
    try:
        return int(m.group(1)), int(m.group(2))
    except (TypeError, ValueError):
        return None


def _load_gpon_inventory_cache(host: str) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    try:
        with open(_GPON_INVENTORY_CACHE, "r", encoding="utf-8") as fh:
            cache = json.load(fh)
    except (OSError, json.JSONDecodeError):
        return {}, {}

    entries = cache.get(host) or []
    reg_mac_map: Dict[str, Any] = {}
    reg_name_map: Dict[str, Any] = {}
    for item in entries:
        idx = str(item.get("idx") or "").strip()
        mac = item.get("mac")
        name = item.get("name")
        if not idx or not mac or not name:
            continue
        if not _parse_mac(mac) or not _parse_gpon_name(name):
            continue
        reg_mac_map[idx] = mac
        reg_name_map[idx] = name
    return reg_mac_map, reg_name_map


def _save_gpon_inventory_cache(
    host: str,
    reg_mac_map: Dict[str, Any],
    reg_name_map: Dict[str, Any],
) -> None:
    entries = []
    for idx, name in reg_name_map.items():
        mac = reg_mac_map.get(idx)
        if not _parse_mac(mac) or not _parse_gpon_name(name):
            continue
        entries.append({"idx": idx, "mac": mac, "name": name})
    if len(entries) < 50:
        return

    try:
        with open(_GPON_INVENTORY_CACHE, "r", encoding="utf-8") as fh:
            cache = json.load(fh)
    except (OSError, json.JSONDecodeError):
        cache = {}
    cache[host] = entries
    tmp_path = _GPON_INVENTORY_CACHE + ".tmp"
    try:
        with open(tmp_path, "w", encoding="utf-8") as fh:
            json.dump(cache, fh, indent=2, sort_keys=True)
        os.replace(tmp_path, _GPON_INVENTORY_CACHE)
    except OSError as exc:
        logger.warning("GPON %s: could not save inventory cache: %s", host, exc)


# =============================================================================
# EPON FETCHER
# =============================================================================

def _fetch_epon(host: str) -> List[Dict[str, Any]]:
    """
    Fetch all EPON ONUs using enterprise ONU registration table + enterprise optical.
    Also walks ifTable for per-ONU traffic bytes (ifInOctets / ifOutOctets).

    MACÃ¢â€ â€™portÃ¢â€ â€™onu_index comes from:
      .3.2.1.3.{N} = MAC
      .3.2.1.5.{N} = "EPON0/1:7" (port=1, onu_index=7)
    ifTable cross-reference: ifDescr "EPON01ONU7" Ã¢â€ â€™ (port=1, onu_index=7) Ã¢â€ â€™ ifIndex
    """
    t_val = _TIMEOUT.get(host, _TIMEOUT_DEFAULT)
    t0 = time.time()

    # Parallel walks: registration table
    mac_rows    = _walk(host, _E_ONU_MAC,  t_val)
    stat_rows   = _walk(host, _E_ONU_STAT, t_val)
    name_rows   = _walk(host, _E_ONU_NAME, t_val)
    alarm_rows  = _walk(host, _E_ALARM,    t_val)

    # Parallel walks: optical (indexed by PORT.ONU)
    rx_rows     = _walk(host, _E_OPT_RX,   t_val)
    tx_rows     = _walk(host, _E_OPT_TX,   t_val)
    temp_rows   = _walk(host, _E_OPT_TEMP, t_val)
    volt_rows   = _walk(host, _E_OPT_VOLT, t_val)
    bias_rows   = _walk(host, _E_OPT_BIAS, t_val)

    # ifTable for per-ONU traffic bytes (indexed by ifIndex)
    epon_if_descr_rows = _walk(host, _IF_DESCR, t_val)
    epon_in_rows       = _walk(host, _IF_IN,    t_val)
    epon_out_rows      = _walk(host, _IF_OUT,   t_val)

    logger.debug("EPON walk %s done in %.1fs", host, time.time() - t0)

    if not mac_rows:
        logger.warning("EPON %s: ONU MAC table empty Ã¢â‚¬â€ SNMP may be down", host)
        return []

    # Build lookup maps keyed by index N (string)
    stat_map  = _build_map(stat_rows,  _E_ONU_STAT)
    name_map  = _build_map(name_rows,  _E_ONU_NAME)
    alarm_map = _build_map(alarm_rows, _E_ALARM)

    # Optical indexed by "{PORT}.{ONU}"
    rx_map    = _build_map(rx_rows,   _E_OPT_RX)
    tx_map    = _build_map(tx_rows,   _E_OPT_TX)
    temp_map  = _build_map(temp_rows, _E_OPT_TEMP)
    volt_map  = _build_map(volt_rows, _E_OPT_VOLT)
    bias_map  = _build_map(bias_rows, _E_OPT_BIAS)

    # Build (port, onu_index) Ã¢â€ â€™ ifIndex map for traffic bytes
    # ifDescr "EPON01ONU7" Ã¢â€ â€™ port=1, onu_index=7 Ã¢â€ â€™ ifIndex from OID suffix
    portonu_to_ifidx: Dict[str, str] = {}
    for oid, _t, v in epon_if_descr_rows:
        m = _EPON_NAME_RE.search(str(v))   # "EPON01ONU7" variant
        if not m:
            m = re.match(r"EPON0?(\d+)ONU(\d+)", str(v), re.IGNORECASE)
        if m:
            p, n = int(m.group(1)), int(m.group(2))
            ifidx = oid.split(".")[-1]
            portonu_to_ifidx[f"{p}.{n}"] = ifidx
    epon_in_map  = {oid.split(".")[-1]: v for oid, _t, v in epon_in_rows  if isinstance(v, int)}
    epon_out_map = {oid.split(".")[-1]: v for oid, _t, v in epon_out_rows if isinstance(v, int)}

    onus: List[Dict[str, Any]] = []
    seen_macs: set = set()

    for oid, _t, v in mac_rows:
        if not oid.startswith(_E_ONU_MAC):
            continue
        n = oid[len(_E_ONU_MAC):].lstrip(".")   # global index N

        mac = _parse_mac(v)
        if not mac or mac in seen_macs:
            continue
        seen_macs.add(mac)

        # Status
        stat_v = stat_map.get(n)
        status = "online" if stat_v == 1 else "offline"

        # Port + onu_index from name "EPON0/1:7"
        name_v = name_map.get(n, "")
        pon_port: Optional[str] = None
        onu_index: Optional[int] = None
        port_num: Optional[int] = None
        m = _EPON_NAME_RE.search(str(name_v))
        if m:
            port_num = int(m.group(1))
            onu_index = int(m.group(2))
            pon_port = f"0/{port_num}"
        else:
            # Check for physical PON port name like "PON1"
            m_phys = re.search(r"PON(\d+)", str(name_v), re.IGNORECASE)
            if m_phys:
                port_num = int(m_phys.group(1))
                pon_port = f"0/{port_num}"
                onu_index = None

        # Dying gasp from alarm state (speculative: 0=no alarm, 26=dying_gasp)
        alarm_v = alarm_map.get(n, 0)
        dying_gasp = (alarm_v == _E_DG_IDX)

        # Optical (indexed by port_num.onu_index)
        opt_key = f"{port_num}.{onu_index}" if (pon_port and onu_index is not None) else None
        rx_dbm = _parse_epon_rx(rx_map.get(opt_key)) if opt_key else None
        tx_dbm = _parse_epon_rx(tx_map.get(opt_key)) if opt_key else None
        temp   = _parse_epon_opt_simple(temp_map.get(opt_key)) if opt_key else None
        volt   = _parse_epon_opt_simple(volt_map.get(opt_key)) if opt_key else None
        bias   = _parse_epon_opt_simple(bias_map.get(opt_key)) if opt_key else None

        # Traffic bytes from ifTable cross-reference
        ifidx = portonu_to_ifidx.get(f"{port_num}.{onu_index}") if pon_port else None
        rx_bytes = epon_in_map.get(ifidx) if ifidx else None
        tx_bytes = epon_out_map.get(ifidx) if ifidx else None

        onus.append({
            "mac_address":          mac,
            "olt_host":             host,
            "status":               status,
            "rx_power_dbm":         rx_dbm,
            "tx_power_dbm":         tx_dbm,
            "temperature_c":        temp,
            "voltage_mv":           volt,
            "tx_bias_current_ma":   bias,
            "dying_gasp":           dying_gasp,
            "pon_port":             pon_port,
            "onu_index":            onu_index,
            "rx_bytes_cumulative":  rx_bytes,
            "tx_bytes_cumulative":  tx_bytes,
            "_transport":           "snmp",
            "_snmp_n":              n,   # global ONU index (used for reboot SET)
        })

    logger.info("EPON %s: %d ONUs (online=%d, optical=%d) in %.1fs",
                host, len(onus),
                sum(1 for o in onus if o["status"] == "online"),
                sum(1 for o in onus if o["rx_power_dbm"] is not None),
                time.time() - t0)
    return onus


# =============================================================================
# GPON FETCHER
# =============================================================================

def _fetch_gpon(host: str) -> List[Dict[str, Any]]:
    """
    Fetch all GPON ONUs using ifTable (MAC/status/traffic) +
    enterprise GPON optical + dying_gasp phase state.

    ifDescr "GPON01ONU7" Ã¢â€ â€™ port=1, onu_index=7
    Enterprise optical indexed by {PORT}.{ONU}
    """
    t_val = _TIMEOUT.get(host, _TIMEOUT_DEFAULT)
    is_slow_profile = host == "10.10.10.210"
    gpon_reps = 8 if is_slow_profile else 50
    t0 = time.time()

    # Enterprise registration/status tables are the GPON source of truth.
    # ifTable is sparse on .200 and blocked on .210, so it is optional only.
    reg_mac_rows = _walk(host, _G_ONU_MAC, t_val, max_reps=50)
    reg_name_rows = _walk(host, _G_ONU_NAME, t_val, max_reps=gpon_reps)
    status_rows = _walk(host, _G_STATUS, t_val, max_reps=gpon_reps)

    # GPON ifTable is sparse on .200 and blocked on .210. Skip it for the
    # live collector; GPON bandwidth should use PON aggregate counters later.
    descr_rows: List[Tuple] = []
    mac_rows: List[Tuple] = []
    stat_rows: List[Tuple] = []
    in_rows: List[Tuple] = []
    out_rows: List[Tuple] = []

    # Enterprise GPON optical + phase
    phase_rows  = [] if is_slow_profile else _walk(host, _G_PHASE, t_val, max_reps=gpon_reps)
    rx_rows     = _walk(host, _G_OPT_RX,   t_val, max_reps=gpon_reps)
    if is_slow_profile:
        # The .210 OLT answers the main RX table but takes minutes per
        # additional optical column. Keep the live collector bounded and use
        # status + RX as the production minimum for NOC truth.
        tx_rows = []
        olt_rx_rows = []
        temp_rows = []
        volt_rows = []
        bias_rows = []
    else:
        tx_rows     = _walk(host, _G_OPT_TX,   t_val, max_reps=gpon_reps)
        olt_rx_rows = _walk(host, _G_OPT_OLT,  t_val, max_reps=gpon_reps)
        temp_rows   = _walk(host, _G_OPT_TEMP, t_val, max_reps=gpon_reps)
        volt_rows   = _walk(host, _G_OPT_VOLT, t_val, max_reps=gpon_reps)
        bias_rows   = _walk(host, _G_OPT_BIAS, t_val, max_reps=gpon_reps)

    logger.debug("GPON walk %s done in %.1fs", host, time.time() - t0)

    # Build ifTable maps keyed by ifIndex (last OID segment)
    def _idx(oid, prefix):
        return oid[len(prefix):].lstrip(".")

    descr_map = {}
    mac_map   = {}
    stat_map  = {}
    in_map    = {}
    out_map   = {}

    for oid, _t, v in descr_rows:
        descr_map[_idx(oid, _IF_DESCR)] = str(v)
    for oid, _t, v in mac_rows:
        mac_map[_idx(oid, _IF_MAC)] = v
    for oid, _t, v in stat_rows:
        stat_map[_idx(oid, _IF_STATUS)] = v
    for oid, _t, v in in_rows:
        if isinstance(v, int):
            in_map[_idx(oid, _IF_IN)] = v
    for oid, _t, v in out_rows:
        if isinstance(v, int):
            out_map[_idx(oid, _IF_OUT)] = v

    # Enterprise maps keyed by "{PORT}.{ONU}"
    phase_map = _build_map(phase_rows,  _G_PHASE)
    rx_map    = _build_map(rx_rows,     _G_OPT_RX)
    tx_map    = _build_map(tx_rows,     _G_OPT_TX)
    olt_rx_m  = _build_map(olt_rx_rows, _G_OPT_OLT)
    temp_map  = _build_map(temp_rows,   _G_OPT_TEMP)
    volt_map  = _build_map(volt_rows,   _G_OPT_VOLT)
    bias_map  = _build_map(bias_rows,   _G_OPT_BIAS)
    reg_mac_map = _build_map(reg_mac_rows, _G_ONU_MAC)
    reg_name_map = _build_map(reg_name_rows, _G_ONU_NAME)
    status_map = _build_map(status_rows, _G_STATUS)

    if reg_mac_map and reg_name_map:
        _save_gpon_inventory_cache(host, reg_mac_map, reg_name_map)
    else:
        cached_mac_map, cached_name_map = _load_gpon_inventory_cache(host)
        if cached_mac_map and cached_name_map:
            logger.warning(
                "GPON %s: live registration table incomplete (mac=%d, name=%d); "
                "using cached identity map with fresh status/RX",
                host,
                len(reg_mac_map),
                len(reg_name_map),
            )
            reg_mac_map = cached_mac_map
            reg_name_map = cached_name_map

    if not reg_mac_map or not reg_name_map:
        logger.warning("GPON %s: registration table empty - SNMP may be down", host)
        return []
    if is_slow_profile and not rx_map:
        logger.warning(
            "GPON %s: RX optical table timed out; skipping this host so NOC does not ingest status-only data",
            host,
        )
        return []

    onus: List[Dict[str, Any]] = []
    seen_macs: set = set()
    if_traffic_by_placement: Dict[str, Dict[str, Any]] = {}
    for iidx, name in descr_map.items():
        m = _GPON_DESCR_RE.match(name)
        if not m:
            continue
        port_num = int(m.group(1))
        onu_index = int(m.group(2))
        if_traffic_by_placement[f"{port_num}.{onu_index}"] = {
            "rx_bytes_cumulative": in_map.get(iidx),
            "tx_bytes_cumulative": out_map.get(iidx),
            "status": stat_map.get(iidx),
        }

    for idx, name in reg_name_map.items():
        placement = _parse_gpon_name(name)
        if not placement:
            continue

        port_num, onu_index = placement
        pon_port  = f"0/{port_num}"
        opt_key   = f"{port_num}.{onu_index}"

        mac = _parse_mac(reg_mac_map.get(idx))
        if not mac or mac in seen_macs:
            continue
        seen_macs.add(mac)

        # Phase/dying_gasp from enterprise GPON status table
        phase = phase_map.get(opt_key)
        try:
            phase_int = int(phase) if phase is not None else None
        except (TypeError, ValueError):
            phase_int = None
        dying_gasp = (phase_int == 4)           # 4 = DyingGasp

        # Optical
        rx_dbm  = _parse_gpon_dbm(rx_map.get(opt_key))
        tx_dbm  = _parse_gpon_dbm(tx_map.get(opt_key))
        olt_rx  = _parse_gpon_dbm(olt_rx_m.get(opt_key))
        temp    = _parse_gpon_dbm(temp_map.get(opt_key))
        volt    = _parse_gpon_dbm(volt_map.get(opt_key))
        bias    = _parse_gpon_dbm(bias_map.get(opt_key))

        traffic = if_traffic_by_placement.get(opt_key, {})
        stat_v = status_map.get(opt_key, traffic.get("status"))
        try:
            stat_int = int(stat_v) if stat_v is not None else None
        except (TypeError, ValueError):
            stat_int = None
        if phase_int in {5, 6}:
            status = "offline"
        elif stat_int is not None:
            status = "online" if stat_int == 1 else "offline"
        else:
            # Some GPON OLTs intermittently time out on the status table while
            # still returning live optical rows. A fresh RX row is stronger
            # evidence than defaulting every ONU offline.
            status = "online" if rx_dbm is not None else "offline"

        onus.append({
            "mac_address":          mac,
            "olt_host":             host,
            "status":               status,
            "rx_power_dbm":         rx_dbm,
            "tx_power_dbm":         tx_dbm,
            "olt_rx_power_dbm":     olt_rx,   # extra field Ã¢â‚¬â€ OLT-side measurement
            "temperature_c":        temp,
            "voltage_mv":           volt,
            "tx_bias_current_ma":   bias,
            "dying_gasp":           dying_gasp,
            "pon_port":             pon_port,
            "onu_index":            onu_index,
            "rx_bytes_cumulative":  traffic.get("rx_bytes_cumulative"),
            "tx_bytes_cumulative":  traffic.get("tx_bytes_cumulative"),
            "_transport":           "snmp",
        })

    logger.info("GPON %s: %d ONUs (online=%d, optical=%d) in %.1fs",
                host, len(onus),
                sum(1 for o in onus if o["status"] == "online"),
                sum(1 for o in onus if o["rx_power_dbm"] is not None),
                time.time() - t0)
    return onus


# =============================================================================
# HOST TYPE DETECTION
# =============================================================================

_EPON_HOSTS = frozenset({"10.10.10.100"})
_GPON_HOSTS = frozenset({"10.10.10.200", "10.10.10.210"})


def _is_epon(host: str) -> bool:
    return host in _EPON_HOSTS


def _is_gpon(host: str) -> bool:
    return host in _GPON_HOSTS


# =============================================================================
# PUBLIC API Ã¢â‚¬â€ same signatures as olt_client.py
# =============================================================================

class OLTSNMPClient:
    """
    SNMP-only OLT client. Returns full ONU data (optical + status + dying_gasp)
    without any Telnet dependency.
    """

    def __init__(self, host: str):
        self.host = host

    def get_all_onus(self) -> List[Dict[str, Any]]:
        if _is_epon(self.host):
            return _fetch_epon(self.host)
        if _is_gpon(self.host):
            return _fetch_gpon(self.host)
        logger.warning("SNMP: unknown OLT host %s Ã¢â‚¬â€ not in EPON or GPON list", self.host)
        return []

    def get_onu_by_mac(self, mac_address: str) -> Optional[Dict[str, Any]]:
        mac_norm = mac_address.upper().replace("-", ":").replace(" ", "")
        return next(
            (o for o in self.get_all_onus()
             if (o.get("mac_address") or "").upper() == mac_norm),
            None,
        )

    def get_lan_mac_match(self, lan_mac: str) -> Dict[str, Any]:
        return lookup_lan_mac(self.host, lan_mac)

    def reboot_onu(self, pon_port: str, onu_index: int) -> bool:
        """
        Attempt SNMP SET reboot.
        EPON: SET .3.1.2.1.10.{N} = 1 using 'private' community.
              N is the global ONU index from _snmp_n field.
        GPON: reboot OID not yet confirmed Ã¢â‚¬â€ returns False (use Telnet path).

        IMPORTANT: This OID is not visible in SNMP GET walks (write-only) so
        it cannot be pre-verified. Test with:
          snmpset -v2c -c private 10.10.10.100:162 \
            1.3.6.1.4.1.37950.1.1.5.10.3.1.2.1.10.{N} i 1
        Start with a test ONU before using in production.
        """
        if not _is_epon(self.host):
            logger.info("GPON reboot via SNMP SET not confirmed Ã¢â‚¬â€ use Telnet")
            return False

        # Find global index N for this (pon_port, onu_index)
        onus = self.get_all_onus()
        port_num = int(str(pon_port).split("/")[-1]) if "/" in str(pon_port) else int(pon_port)
        match = next(
            (o for o in onus
             if o.get("onu_index") == onu_index
             and o.get("pon_port", "").endswith(f"/{port_num}")),
            None,
        )
        if not match:
            logger.warning("Reboot: ONU port=%s idx=%s not found in SNMP data", pon_port, onu_index)
            return False

        n = match.get("_snmp_n")
        if n is None:
            logger.warning("Reboot: no _snmp_n for ONU port=%s idx=%s", pon_port, onu_index)
            return False

        reboot_oid = f"{_E_REBOOT}.{n}"
        logger.info("SNMP SET reboot: %s OID=%s val=%d", self.host, reboot_oid, _REBOOT_VAL)
        ok = _snmp_set_int(
            self.host, SNMP_COMMUNITY_WRITE, reboot_oid, _REBOOT_VAL,
            port=SNMP_PORT, timeout=10,
        )
        if ok:
            logger.info("SNMP reboot acknowledged: port=%s onu=%s", pon_port, onu_index)
        else:
            logger.warning("SNMP reboot no response (OID may be wrong Ã¢â‚¬â€ verify with snmpset)")
        return ok


# =============================================================================
# CONVENIENCE FUNCTIONS Ã¢â‚¬â€ drop-in replacements for olt_client.py
# =============================================================================

def has_snmp_data(host: str) -> bool:
    """True for all known OLT hosts (hardcoded OIDs, no profile needed)."""
    return _is_epon(host) or _is_gpon(host)


def get_all_onus(olt_host: str) -> List[Dict[str, Any]]:
    return OLTSNMPClient(olt_host).get_all_onus()


def get_onu_by_mac(olt_host: str, mac_address: str) -> Optional[Dict[str, Any]]:
    return OLTSNMPClient(olt_host).get_onu_by_mac(mac_address)


def get_lan_mac_match(olt_host: str, lan_mac: str) -> Dict[str, Any]:
    return OLTSNMPClient(olt_host).get_lan_mac_match(lan_mac)


def reboot_onu(olt_host: str, pon_port: str, onu_index: int) -> bool:
    return OLTSNMPClient(olt_host).reboot_onu(pon_port, onu_index)
