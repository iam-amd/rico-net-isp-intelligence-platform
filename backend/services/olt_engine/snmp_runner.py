"""
SNMP runner â€” bridges backend â†’ Pi â†’ OLT.

OLTs are on the private OLT management LAN, only reachable from the collector host.
We SSH to the Pi and run `snmpbulkwalk` / `snmpget`, then parse the output.

Future: replace with a clean REST route on olt-proxy (POST /snmp/walk).
For now SSH+snmpwalk is the proven path used by the verifier.
"""
from __future__ import annotations

import os
import re
import logging
from typing import List, Tuple

import paramiko

logger = logging.getLogger("rico_net.olt_engine.snmp")

PI_HOST = os.environ.get("PI_HOST", "100.x.x.x")
PI_USER = os.environ.get("PI_USER", "rico")
PI_PASS = os.environ.get("PI_PASS", "")

# Default community/port used when the OLT is not in the registry (legacy scripts,
# probes). The engine faÃ§ade primes the olt_registry cache and per-OLT walks use
# the registry's community/port instead.
COMMUNITY = os.environ.get("OLT_SNMP_COMMUNITY", "public")
SNMP_PORT = int(os.environ.get("OLT_SNMP_PORT", "162"))


def _olt_snmp_settings(olt_host: str) -> tuple[str, int, int, int]:
    """Resolve (community, port, default_timeout_sec, default_chunk) for an OLT.
    Reads from the olt_registry cache; falls back to per-host hardcoded defaults
    if registry is cold, then to module env defaults."""
    try:
        from backend.services import olt_registry
        cfg = olt_registry.peek(olt_host)
        if cfg:
            return cfg.snmp_community, cfg.snmp_port, cfg.snmp_timeout_sec, cfg.snmp_chunk
    except Exception:
        pass
    return COMMUNITY, SNMP_PORT, _LEGACY_TIMEOUT.get(olt_host, 5), _LEGACY_CHUNK.get(olt_host, 50)


# Legacy fallbacks (kept for scripts that don't prime the registry cache).
_LEGACY_TIMEOUT = {
    "10.10.10.100": 5,
    "10.10.10.200": 5,
    "10.10.10.210": 30,
}
_LEGACY_CHUNK = {
    "10.10.10.100": 50,
    "10.10.10.200": 50,
    "10.10.10.210": 10,
}


_ssh: paramiko.SSHClient | None = None


def _get_ssh() -> paramiko.SSHClient:
    """Lazy-open a single SSH connection per process. Reconnects on failure."""
    global _ssh
    if _ssh is not None:
        try:
            _ssh.get_transport().send_ignore()
            return _ssh
        except Exception:
            try: _ssh.close()
            except Exception: pass
            _ssh = None

    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    if not PI_PASS:
        raise RuntimeError("PI_PASS is required in the local environment before running SNMP probes")
    c.connect(PI_HOST, username=PI_USER, password=PI_PASS, timeout=15,
              look_for_keys=False, allow_agent=False)
    logger.info("SSH connection opened to %s", PI_HOST)
    _ssh = c
    return _ssh


def snmpbulkwalk(
    olt_host: str,
    oid: str,
    *,
    timeout: int = 90,
    snmp_timeout: int | None = None,   # per-OID SNMP timeout (-t)
    snmp_chunk: int | None = None,     # max-repetitions per bulk (-Cr)
    retries: int = 0,                  # snmp-level retries (-r)
    empty_retry: bool = False,         # retry once on empty result (for flaky OLTs)
) -> List[Tuple[str, str]]:
    """Walk one OID on the given OLT.

    For slow OLT agents (e.g., .210 V1.4.8R) pass `snmp_timeout=30 snmp_chunk=10
    empty_retry=True`. Defaults work for healthy OLTs.

    Returns list of (full_oid, value_string) tuples. Empty list on error.
    """
    community, port, default_t, default_chk = _olt_snmp_settings(olt_host)
    t   = snmp_timeout if snmp_timeout is not None else default_t
    chk = snmp_chunk   if snmp_chunk   is not None else default_chk

    def _run_once() -> List[Tuple[str, str]]:
        cmd = (f"snmpbulkwalk -v2c -c {community} -On -t {t} -r {retries} "
               f"-Cr{chk} {olt_host}:{port} {oid}")
        ssh = _get_ssh()
        stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
        out = stdout.read().decode(errors="replace")

        result: List[Tuple[str, str]] = []
        for line in out.splitlines():
            if "= " not in line:
                continue
            oid_part, _, val_part = line.partition(" = ")
            result.append((oid_part.strip(), val_part.strip()))
        return result

    rows = _run_once()
    if not rows and empty_retry:
        logger.info("snmpbulkwalk %s %s: empty, retrying with extended timeout", olt_host, oid)
        # Single retry with even longer timeout & smaller chunks
        t = max(t, 30); chk = min(chk, 5)
        rows = _run_once()
    return rows


def snmpget(olt_host: str, oid: str, *, timeout: int = 10) -> str | None:
    """Single SNMP GET. Returns the raw value string or None on error."""
    community, port, _, _ = _olt_snmp_settings(olt_host)
    cmd = f"snmpget -v2c -c {community} -On -t 5 -r 1 {olt_host}:{port} {oid}"
    ssh = _get_ssh()
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode(errors="replace").strip()
    if "= " in out:
        return out.split("= ", 1)[1].strip()
    return None


# â”€â”€â”€ Parsers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

_HEX_BYTE = re.compile(r"^[0-9A-Fa-f]{2}$")

def parse_hex_string_value(value: str) -> str | None:
    """Parse "Hex-STRING: 8C C7 C3 30 AC 60" â†’ "8C:C7:C3:30:AC:60"."""
    if "Hex-STRING:" not in value:
        return None
    payload = value.split("Hex-STRING:", 1)[1].strip()
    parts = payload.split()
    if len(parts) != 6 or not all(_HEX_BYTE.match(p) for p in parts):
        return None
    return ":".join(p.upper() for p in parts)


def parse_string_value(value: str) -> str | None:
    """Parse `STRING: "EPON0/1:7"` â†’ "EPON0/1:7" or `STRING: foo` â†’ "foo"."""
    if "STRING:" not in value:
        return None
    payload = value.split("STRING:", 1)[1].strip()
    if payload.startswith('"') and payload.endswith('"'):
        payload = payload[1:-1]
    return payload or None


def parse_integer_value(value: str) -> int | None:
    if "INTEGER:" not in value:
        return None
    payload = value.split("INTEGER:", 1)[1].strip()
    try:
        return int(payload)
    except ValueError:
        return None


_RX_RE = re.compile(r"\((-?[\d.]+)\s*dBm\)")
def parse_rx_power(value: str) -> float | None:
    """Parse `STRING: "0.03 mW (-16.02 dBm)"` â†’ -16.02."""
    s = parse_string_value(value) or value
    m = _RX_RE.search(s)
    if not m:
        return None
    try:
        return float(m.group(1))
    except ValueError:
        return None


_NUM_RE = re.compile(r"-?[\d.]+")
def parse_first_float(value: str) -> float | None:
    """Pull the first float out of any string value."""
    s = parse_string_value(value) or value
    m = _NUM_RE.search(s)
    if not m:
        return None
    try:
        return float(m.group(0))
    except ValueError:
        return None


def is_responsive(olt_host: str, *, snmp_timeout: int = 5) -> bool:
    """
    Quick sysDescr probe â€” true if OLT SNMP responds within snmp_timeout sec.
    Use as a precheck before launching expensive walks; if False, the OLT is
    likely either down or saturated (e.g. poller mid-walk) and the walk would
    just waste 60+ seconds.
    """
    community, port, _, _ = _olt_snmp_settings(olt_host)
    cmd = f"snmpget -v2c -c {community} -On -t {snmp_timeout} -r 0 {olt_host}:{port} 1.3.6.1.2.1.1.1.0"
    try:
        ssh = _get_ssh()
        stdin, stdout, stderr = ssh.exec_command(cmd, timeout=snmp_timeout + 5)
        out = stdout.read().decode(errors="replace").strip()
        return "STRING:" in out
    except Exception:
        return False


def close():
    """Close the persistent SSH connection (call at end of script)."""
    global _ssh
    if _ssh is not None:
        try: _ssh.close()
        except Exception: pass
        _ssh = None
