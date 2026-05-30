"""
OLT Proxy Configuration
Defines all settings for OLT connection, security, and timeout parameters.
"""

import os
from dotenv import load_dotenv

# Try local dir first (Pi deployment), then parent dir (home PC dev)
_here = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(_here, ".env"))
load_dotenv(os.path.join(_here, "..", ".env"))


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}

# ============================================================================
# OLT HARDWARE SETTINGS
# ============================================================================

# Netlink OLT IP addresses
_DEFAULT_OLT_HOSTS = [
    "10.10.10.100",    # EPON OLT  (firmware V2.03.75R, ~357 ONUs)
    "10.10.10.200",    # GPON OLT 1 (firmware V2.3.1R, hardware V2.1.8)
    "10.10.10.210",    # GPON OLT 2 (firmware V1.4.8R, hardware V3.1.8)
]
OLT_HOSTS = [
    host.strip()
    for host in os.getenv("OLT_HOSTS", "").split(",")
    if host.strip()
] or _DEFAULT_OLT_HOSTS

# Telnet connection (Phase 2a)
OLT_TELNET_PORT = 23
OLT_TELNET_USER = os.getenv("OLT_TELNET_USER", "")
OLT_TELNET_PASSWORD = os.getenv("OLT_TELNET_PASSWORD", "")
OLT_TELNET_TIMEOUT = 10  # seconds
# Enable password (same as login for this OLT â€” override via env if different)

# SNMP v2c â€” Netlink OLTs use port 162 for the SNMP agent (non-standard;
# 162 is shared between the OLT's own SNMP agent and the trap destination).
# Confirmed via `show running-config | include snmp` on all 3 OLTs.
SNMP_PORT = 162
SNMP_COMMUNITY_READ = "public"
SNMP_COMMUNITY_WRITE = "private"
SNMP_TIMEOUT = 5  # seconds
SNMP_RETRIES = 1

# Netlink enterprise OID confirmed via sysObjectID probe on 10.10.10.210:162
OLT_ENTERPRISE_OID = "1.3.6.1.4.1.37950"

# ============================================================================
# PROXY SECURITY
# ============================================================================

# On-demand proxy token. Separate from collector ingest credentials.
PROXY_TOKEN = os.getenv("PROXY_TOKEN", "")

# Hardware safety gates. Starting the proxy must never imply OLT access.
# Enable read-only collection explicitly on the Pi/engine host. Reboot/control
# commands require a second explicit flag and should stay off during trials.
ALLOW_OLT_HARDWARE_ACCESS = _env_bool("ALLOW_OLT_HARDWARE_ACCESS", False)
ALLOW_OLT_REBOOT_COMMANDS = _env_bool("ALLOW_OLT_REBOOT_COMMANDS", False)

# Proxy listening port
PROXY_PORT = int(os.getenv("PROXY_PORT", 9000))

# Proxy host (0.0.0.0 = listen on all interfaces)
PROXY_HOST = "0.0.0.0"

# ============================================================================
# TIMEOUTS & LIMITS
# ============================================================================

# Request timeout for all OLT operations
REQUEST_TIMEOUT_SEC = 10

# Maximum number of ONUs to return in a single scan
MAX_SCAN_RESULTS = 2000

# MAC search batch size (when polling multiple OLTs)
OLT_BATCH_SIZE = 4

# ============================================================================
# LOGGING
# ============================================================================

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
LOG_FORMAT = "%(asctime)s - [OLT_PROXY] - %(levelname)s - %(message)s"

# ============================================================================
# TRANSPORT SELECTION
# ============================================================================

# Legacy mode flag (kept for backward compatibility)
OLT_CLIENT_MODE = os.getenv("OLT_CLIENT_MODE", "snmp")
if OLT_CLIENT_MODE not in ["telnet", "snmp"]:
    raise ValueError(f"OLT_CLIENT_MODE must be 'telnet' or 'snmp', got {OLT_CLIENT_MODE}")

# Phase 3: primary/fallback transport for olt_poller.py
# "snmp"   = try SNMP first (fast, ~30s cycle); fall back to Telnet on failure/empty result
# "telnet" = Telnet only (reliable, ~400s cycle) â€” use when SNMP not yet audited
OLT_PRIMARY_TRANSPORT   = os.getenv("OLT_PRIMARY_TRANSPORT",  "snmp")
OLT_FALLBACK_TRANSPORT  = os.getenv("OLT_FALLBACK_TRANSPORT", "none")

if OLT_PRIMARY_TRANSPORT not in ("snmp", "telnet", "web"):
    raise ValueError(f"OLT_PRIMARY_TRANSPORT must be 'snmp', 'telnet', or 'web'")
if OLT_FALLBACK_TRANSPORT not in ("snmp", "telnet", "none"):
    raise ValueError(f"OLT_FALLBACK_TRANSPORT must be 'snmp', 'telnet', or 'none'")

print(f"[CONFIG] Transport: primary={OLT_PRIMARY_TRANSPORT.upper()} fallback={OLT_FALLBACK_TRANSPORT.upper()}")
print(f"[CONFIG] Local Proxy API Token: {'configured' if PROXY_TOKEN else 'not set'}")
print(f"[CONFIG] OLT Hosts: {', '.join(OLT_HOSTS)}")
print(f"[CONFIG] OLT hardware access: {'ENABLED' if ALLOW_OLT_HARDWARE_ACCESS else 'SAFE MODE - disabled'}")
print(f"[CONFIG] OLT reboot commands: {'ENABLED' if ALLOW_OLT_REBOOT_COMMANDS else 'disabled'}")
