"""
SNMP Trap Receiver â€” Rico Net Phase 2
=======================================
Pure-stdlib UDP server that listens for SNMP v1/v2c traps on port 162,
decodes them with raw BER parsing, and POSTs alarm events to the backend.

Requirements:
  - Python 3.x stdlib only (socket, struct â€” no pysnmp)
  - BER decode functions imported from snmp_walk_raw.py

Usage:
  sudo python trap_receiver.py            # port 162 requires root on Linux
  python trap_receiver.py --port 1162     # unprivileged port for testing
  python trap_receiver.py --port 162 --backend http://localhost:8000

Note: On Linux, port 162 requires root or a setcap grant:
  sudo setcap cap_net_bind_service=+ep /usr/bin/python3
"""

import argparse
import json
import logging
import os
import re
import socket
import sys
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

from dotenv import load_dotenv

# Load .env â€” try local dir first (Pi deployment), then parent dir (dev/home PC)
_script_dir = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(_script_dir, ".env"))
load_dotenv(os.path.join(_script_dir, "..", ".env"))

# BER decode helpers from existing snmp_walk_raw.py
from snmp_walk_raw import _decode_tlv, decode_oid, decode_value, decode_int

# Shared MAC normalizer (single source of truth for MAC formatting on the Pi)
from mac_normalizer import normalize_mac as _normalize_mac, is_valid_mac as _is_valid_mac

# =============================================================================
# CONFIGURATION
# =============================================================================

BACKEND_URL: str = os.getenv("BACKEND_URL", "http://localhost:8000").rstrip("/")
INGEST_TOKEN: str = os.getenv("OLT_PROXY_TOKEN", "")
COLLECTOR_HOSTNAME: str = socket.gethostname()
COLLECTOR_ID: str = os.getenv("COLLECTOR_ID", COLLECTOR_HOSTNAME)
LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")

# Disk-backed retry queue: when the backend POST fails, append the alarm to a
# JSON-lines file. A background worker drains the file every RETRY_INTERVAL_SEC.
# Bounded to avoid unbounded disk usage if the backend stays down for hours.
RETRY_QUEUE_PATH: str = os.getenv(
    "TRAP_RETRY_QUEUE_PATH",
    os.path.join(_script_dir, ".trap_retry_queue.jsonl"),
)
RETRY_INTERVAL_SEC: int = int(os.getenv("TRAP_RETRY_INTERVAL_SEC", "60"))
RETRY_QUEUE_MAX: int = int(os.getenv("TRAP_RETRY_QUEUE_MAX", "1000"))
_retry_lock = threading.Lock()

# Known trap types from SNMP link-up / link-down generic trap fields
TRAP_TYPE_MAP: Dict[int, str] = {
    0: "COLD_START",
    1: "WARM_START",
    2: "ONU_OFFLINE",   # linkDown
    3: "ONU_ONLINE",    # linkUp
    4: "AUTH_FAILURE",
    5: "EGP_NEIGHBOR_LOSS",
    6: "ENTERPRISE_SPECIFIC",
}

# Regex to extract MAC address from any string value in varbinds
MAC_RE = re.compile(r"([0-9a-fA-F]{2}[:\-]){5}[0-9a-fA-F]{2}")

# Regex to extract GPON Serial Number from varbind string values
# Format: 3-4 uppercase ASCII letters + exactly 8 hex digits (e.g. GPON00ECDFA4, MONU00E7C059)
GPON_SN_RE = re.compile(r"\b([A-Z]{3,4}[0-9A-Fa-f]{8})\b")

# Netlink GPON enterprise OID prefix for trap classification
NETLINK_OID_PREFIX = "1.3.6.1.4.1.37950"
# Netlink audit/system-log OID subtree â€” fired on every Telnet login, not ONU events
# OID pattern: 1.3.6.1.4.1.37950.1.1.5.10.13.*  (the .10.13 is the syslog subtree)
NETLINK_AUDIT_MARKER = ".10.13."

# Trap deduplication â€” suppress repeated traps from the same ONU within this window (seconds)
# Prevents DyingGasp floods (GPON .210 port 0/8 sends traps every 5s per ONU)
TRAP_DEDUP_WINDOW: int = 1800  # 30 minutes, matches olt_poller.py dedup window
_trap_dedup: Dict[str, float] = {}  # key: "{source_ip}:{onu_id}" â†’ last_post_time

# =============================================================================
# LOGGING
# =============================================================================

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s - [TRAP_RECV] - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("trap_receiver")


# =============================================================================
# PREFLIGHT
# =============================================================================

def _print_preflight_result(ok: bool, name: str, message: str) -> None:
    status = "OK" if ok else "FAIL"
    print(f"[{status}] {name}: {message}")


def _collector_auth_configured(token: str, collector_id: str) -> bool:
    return bool(token.strip()) and bool(collector_id.strip())


def _check_backend_health() -> Tuple[bool, str]:
    try:
        req = Request(f"{BACKEND_URL}/healthz", method="GET")
        with urlopen(req, timeout=10) as resp:
            body = resp.read().decode("utf-8", errors="replace")
        if resp.status != 200:
            return False, f"HTTP {resp.status}: {body[:160]}"
        return True, "backend /healthz responded"
    except Exception as exc:
        return False, str(exc)


def _check_ingest_token() -> Tuple[bool, str]:
    if not _collector_auth_configured(INGEST_TOKEN, COLLECTOR_ID):
        return False, "COLLECTOR_ID and OLT_PROXY_TOKEN are required"
    try:
        req = Request(
            f"{BACKEND_URL}/ingest/verify",
            headers={
                "X-Ingest-Token": INGEST_TOKEN,
                "X-Collector-Id": COLLECTOR_ID,
            },
            method="GET",
        )
        with urlopen(req, timeout=10) as resp:
            body = resp.read().decode("utf-8", errors="replace")
        if resp.status != 200:
            return False, f"HTTP {resp.status}: {body[:160]}"
        data = json.loads(body)
        if data.get("status") != "ok":
            return False, f"unexpected response: {data}"
        return True, "ingest token accepted"
    except HTTPError as exc:
        return False, f"HTTP {exc.code}: {exc.read().decode('utf-8', errors='replace')[:160]}"
    except Exception as exc:
        return False, str(exc)


def _check_retry_queue_writable() -> Tuple[bool, str]:
    directory = os.path.dirname(os.path.abspath(RETRY_QUEUE_PATH)) or "."
    probe_path = os.path.join(directory, ".trap_retry_queue.write_test")
    try:
        os.makedirs(directory, exist_ok=True)
        with open(probe_path, "w", encoding="utf-8") as handle:
            handle.write("ok")
        os.remove(probe_path)
        queued = 0
        if os.path.exists(RETRY_QUEUE_PATH):
            with open(RETRY_QUEUE_PATH, "r", encoding="utf-8") as handle:
                queued = sum(1 for line in handle if line.strip())
        return True, f"writable; queued_events={queued}; path={RETRY_QUEUE_PATH}"
    except Exception as exc:
        return False, str(exc)


def _check_udp_bind(host: str, port: int) -> Tuple[bool, str]:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.bind((host, port))
        return True, f"UDP {host}:{port} bind succeeded"
    except PermissionError as exc:
        return False, f"UDP {host}:{port} requires root or cap_net_bind_service: {exc}"
    except OSError as exc:
        return False, f"UDP {host}:{port} bind failed: {exc}"
    finally:
        sock.close()


def run_preflight(host: str = "0.0.0.0", port: int = 162, *, skip_bind_check: bool = False) -> bool:
    checks: List[bool] = []

    print("Rico Net SNMP trap receiver preflight")
    print(f"backend_url={BACKEND_URL}")
    print(f"collector_id={COLLECTOR_ID}")
    print(f"collector_hostname={COLLECTOR_HOSTNAME}")
    print(f"retry_queue={RETRY_QUEUE_PATH}")
    print(f"bind={host}:{port}")
    print("")

    auth_ok = _collector_auth_configured(INGEST_TOKEN, COLLECTOR_ID)
    checks.append(auth_ok)
    _print_preflight_result(
        auth_ok,
        "collector-auth-env",
        "COLLECTOR_ID and OLT_PROXY_TOKEN are configured" if auth_ok else "COLLECTOR_ID and OLT_PROXY_TOKEN are required",
    )

    ok, message = _check_retry_queue_writable()
    checks.append(ok)
    _print_preflight_result(ok, "retry-queue", message)

    ok, message = _check_backend_health()
    checks.append(ok)
    _print_preflight_result(ok, "backend-healthz", message)

    ok, message = _check_ingest_token()
    checks.append(ok)
    _print_preflight_result(ok, "ingest-token-verify", message)

    if skip_bind_check:
        _print_preflight_result(True, "udp-bind", "skipped by flag")
    else:
        ok, message = _check_udp_bind(host, port)
        checks.append(ok)
        _print_preflight_result(ok, "udp-bind", message)

    print("")
    if all(checks):
        print("Preflight passed: trap receiver is ready to run.")
        return True
    print("Preflight failed: fix the failed checks before starting the trap receiver.")
    return False


# =============================================================================
# BER / SNMP TRAP PARSING
# =============================================================================

def _decode_length(data: bytes, pos: int) -> Tuple[int, int]:
    first = data[pos]
    if first < 0x80:
        return first, pos + 1
    num_bytes = first & 0x7F
    n = 0
    for i in range(num_bytes):
        n = (n << 8) | data[pos + 1 + i]
    return n, pos + 1 + num_bytes


def _parse_varbind_list(vb_data: bytes) -> List[Tuple[str, str, Any]]:
    """
    Parse a BER-encoded VarBindList.
    Returns list of (oid_str, type_name, value).
    """
    results = []
    pos = 0
    while pos < len(vb_data):
        try:
            tag, vb, pos = _decode_tlv(vb_data, pos)
            bpos = 0
            tag2, oid_val, bpos = _decode_tlv(vb, bpos)
            oid_str = decode_oid(oid_val)
            tag3, raw_val, bpos = _decode_tlv(vb, bpos)
            t, v = decode_value(tag3, raw_val)
            results.append((oid_str, t, v))
        except Exception as exc:
            logger.debug("Varbind parse error at pos %d: %s", pos, exc)
            break
    return results


def parse_snmp_v1_trap(data: bytes) -> Optional[Dict[str, Any]]:
    """
    Parse an SNMP v1 Trap PDU (PDU tag 0xA4).
    Structure:
      SEQUENCE {
        version INTEGER (0 = v1)
        community OCTET STRING
        Trap-PDU {
          enterprise OID
          agent-addr IpAddress
          generic-trap INTEGER
          specific-trap INTEGER
          time-stamp TimeTicks
          variable-bindings SEQUENCE
        }
      }
    Returns a dict with parsed fields, or None on error.
    """
    try:
        if data[0] != 0x30:
            return None
        msg_len, pos = _decode_length(data, 1)
        msg = data[pos:pos + msg_len]
        mpos = 0

        # version
        tag, version_val, mpos = _decode_tlv(msg, mpos)
        version = decode_int(version_val)

        # community
        tag, community_val, mpos = _decode_tlv(msg, mpos)
        community = community_val.decode("utf-8", errors="replace")

        # PDU tag
        pdu_tag = msg[mpos]
        pdu_len, mpos = _decode_length(msg, mpos + 1)
        pdu = msg[mpos:mpos + pdu_len]
        ppos = 0

        if pdu_tag == 0xA4:
            # v1 Trap PDU
            tag, ent_val, ppos = _decode_tlv(pdu, ppos)
            enterprise_oid = decode_oid(ent_val)

            tag, agent_val, ppos = _decode_tlv(pdu, ppos)
            agent_addr = ".".join(str(b) for b in agent_val) if len(agent_val) == 4 else agent_val.hex()

            tag, generic_val, ppos = _decode_tlv(pdu, ppos)
            generic_trap = decode_int(generic_val)

            tag, specific_val, ppos = _decode_tlv(pdu, ppos)
            specific_trap = decode_int(specific_val)

            tag, time_val, ppos = _decode_tlv(pdu, ppos)
            time_ticks = decode_int(time_val)

            tag, vb_list_val, ppos = _decode_tlv(pdu, ppos)
            varbinds = _parse_varbind_list(vb_list_val)

            return {
                "version": "v1",
                "community": community,
                "enterprise_oid": enterprise_oid,
                "agent_addr": agent_addr,
                "generic_trap": generic_trap,
                "specific_trap": specific_trap,
                "time_ticks": time_ticks,
                "varbinds": varbinds,
            }

        elif pdu_tag == 0xA7:
            # v2c SNMPv2-Trap PDU
            tag, req_id_val, ppos = _decode_tlv(pdu, ppos)
            tag, err_status_val, ppos = _decode_tlv(pdu, ppos)
            tag, err_idx_val, ppos = _decode_tlv(pdu, ppos)
            tag, vb_list_val, ppos = _decode_tlv(pdu, ppos)
            varbinds = _parse_varbind_list(vb_list_val)

            # Extract sysUpTime and snmpTrapOID from mandatory first two varbinds
            trap_oid = ""
            if len(varbinds) >= 2:
                trap_oid = str(varbinds[1][2]) if varbinds[1][1] == "oid" else ""

            return {
                "version": "v2c",
                "community": community,
                "enterprise_oid": trap_oid,
                "agent_addr": "",
                "generic_trap": -1,
                "specific_trap": -1,
                "time_ticks": decode_int(varbinds[0][2]) if varbinds and varbinds[0][1] in ("timeticks", "int") else 0,
                "varbinds": varbinds,
            }

        else:
            logger.debug("Unexpected PDU tag: 0x%02x", pdu_tag)
            return None

    except Exception as exc:
        logger.error("parse_snmp_trap error: %s", exc, exc_info=True)
        return None


def _extract_mac_from_varbinds(varbinds: List[Tuple[str, str, Any]]) -> Optional[str]:
    """
    Scan varbind values for a MAC address pattern.
    Returns the canonical AA:BB:CC:DD:EE:FF form via mac_normalizer, or None.
    """
    for oid, t, v in varbinds:
        if v is None:
            continue
        m = MAC_RE.search(str(v))
        if m:
            try:
                candidate = _normalize_mac(m.group(0))
            except ValueError:
                continue
            if candidate != "00:00:00:00:00:00":
                return candidate
        # Also check if it's a raw 6-byte octet string (hex-encoded = 12 chars)
        if t == "hex" and isinstance(v, str) and len(v) == 12:
            try:
                candidate = _normalize_mac(v)
            except ValueError:
                continue
            if candidate != "00:00:00:00:00:00":
                return candidate
    return None


def _extract_gpon_sn_from_varbinds(varbinds: List[Tuple[str, str, Any]]) -> Optional[str]:
    """
    Scan varbind values for a GPON Serial Number (e.g. GPON00ECDFA4, MONU00E7C059).

    Two forms handled:
      1. Already-formatted string:  "GPON00ECDFA4"  â†’ GPON_SN_RE match
      2. Raw 8-byte octet string:   first 4 bytes = ASCII letters + last 4 bytes = binary
         decoded as hex string "474f504e00ecdfa4" â†’ reconstruct "GPON00ECDFA4"

    Returns "SN:GPON00ECDFA4" (with SN: prefix matching onu_latest.mac_address format),
    or None if no SN found.
    """
    for oid, t, v in varbinds:
        if v is None:
            continue

        # Form 1: formatted string in any 'str' value
        if t == "str":
            m = GPON_SN_RE.search(str(v))
            if m:
                return f"SN:{m.group(1).upper()}"

        # Form 2: raw 8-byte octet string (hex-encoded = 16 chars)
        if t == "hex" and isinstance(v, str) and len(v) == 16:
            try:
                raw = bytes.fromhex(v)
                # First 4 bytes must be ASCII uppercase letters (A-Z)
                if all(0x41 <= b <= 0x5A for b in raw[:4]):
                    vendor = raw[:4].decode("ascii")
                    serial = raw[4:].hex().upper()
                    return f"SN:{vendor}{serial}"
            except (ValueError, UnicodeDecodeError):
                pass

    return None


def _classify_trap(parsed: Dict[str, Any], source_ip: str) -> Dict[str, Any]:
    """
    Determine event_type, mac_address, pon_port, onu_index from parsed trap.
    Returns a dict ready to POST to /ingest/alarm-event.

    GPON traps carry Serial Number (not MAC) in varbinds.
    We store these as mac_address="SN:GPON00ECDFA4" to match onu_latest.
    """
    varbinds = parsed.get("varbinds", [])
    generic_trap = parsed.get("generic_trap", -1)
    specific_trap = parsed.get("specific_trap", -1)
    enterprise_oid = parsed.get("enterprise_oid", "")
    version = parsed.get("version", "unknown")

    # â”€â”€ Filter out Netlink system/audit traps (fired on every Telnet login) â”€â”€â”€
    # Enterprise OID 1.3.6.1.4.1.37950.1.1.5.10.13.* = syslog/audit events, not ONU events
    if NETLINK_AUDIT_MARKER in enterprise_oid:
        return {
            "mac_address": "00:00:00:00:00:00",
            "event_type": "SYSTEM_AUDIT",
            "olt_host": source_ip,
            "pon_port": None,
            "onu_index": None,
            "payload": {"enterprise_oid": enterprise_oid},
            "received_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }

    # â”€â”€ Determine event_type â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    if version == "v1":
        event_type = TRAP_TYPE_MAP.get(generic_trap, "ENTERPRISE_SPECIFIC")
        if generic_trap == 6:
            # Enterprise-specific â€” map well-known Netlink specific_trap codes
            # Netlink GPON: specific_trap=7 â†’ dying gasp; 1 â†’ offline; 2 â†’ online
            if specific_trap == 7:
                event_type = "DYING_GASP"
            elif specific_trap in (1, 3, 5):
                event_type = "ONU_OFFLINE"
            elif specific_trap in (2, 4, 6):
                event_type = "ONU_ONLINE"
            else:
                event_type = f"ENTERPRISE_{specific_trap}"
    else:
        # v2c: infer from snmpTrapOID value (second varbind)
        oid_lower = enterprise_oid.lower()
        # Standard linkDown/linkUp OIDs: 1.3.6.1.6.3.1.1.5.3 / .5.4
        if "linkdown" in oid_lower or enterprise_oid.endswith(".5.3") or enterprise_oid.endswith(".3.6.1.6.3.1.1.5.3"):
            event_type = "ONU_OFFLINE"
        elif "linkup" in oid_lower or enterprise_oid.endswith(".5.4") or enterprise_oid.endswith(".3.6.1.6.3.1.1.5.4"):
            event_type = "ONU_ONLINE"
        elif "coldstart" in oid_lower or enterprise_oid.endswith(".5.1"):
            event_type = "COLD_START"
        elif "warmstart" in oid_lower or enterprise_oid.endswith(".5.2"):
            event_type = "WARM_START"
        elif "authfailure" in oid_lower or enterprise_oid.endswith(".5.5"):
            event_type = "AUTH_FAILURE"
        elif NETLINK_OID_PREFIX in enterprise_oid:
            # Netlink enterprise-specific trap â€” check last segment for type hints
            # Netlink GPON typically: .7 = dying gasp, .1/.3 = offline, .2/.4 = online
            last_seg = enterprise_oid.split(".")[-1]
            if last_seg == "7":
                event_type = "DYING_GASP"
            elif last_seg in ("1", "3", "5", "9"):
                event_type = "ONU_OFFLINE"
            elif last_seg in ("2", "4", "6", "10"):
                event_type = "ONU_ONLINE"
            else:
                event_type = "SNMP_TRAP"
        else:
            event_type = "SNMP_TRAP"

    # â”€â”€ Extract ONU identifier (MAC for EPON, SN:xxx for GPON) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    mac = _extract_mac_from_varbinds(varbinds)
    if mac is None or mac == "00:00:00:00:00:00":
        # Try GPON Serial Number extraction
        gpon_sn = _extract_gpon_sn_from_varbinds(varbinds)
        mac = gpon_sn if gpon_sn else "00:00:00:00:00:00"

    # â”€â”€ Build varbind payload (serializable) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    vb_payload = [{"oid": oid, "type": t, "value": str(v)} for oid, t, v in varbinds]

    return {
        "mac_address": mac,
        "event_type": event_type,
        "olt_host": source_ip,
        "pon_port": None,
        "onu_index": None,
        "payload": {
            "version": version,
            "community": parsed.get("community", ""),
            "enterprise_oid": enterprise_oid,
            "generic_trap": generic_trap,
            "specific_trap": specific_trap,
            "agent_addr": parsed.get("agent_addr", source_ip),
            "time_ticks": parsed.get("time_ticks", 0),
            "varbinds": vb_payload,
        },
        "received_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


# =============================================================================
# BACKEND POST
# =============================================================================

def _post_alarm_once(event: Dict[str, Any]) -> bool:
    """One POST attempt. Returns True on 2xx, False on any failure."""
    url = f"{BACKEND_URL}/ingest/alarm-event"
    body = json.dumps(event).encode("utf-8")
    req = Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "X-Ingest-Token": INGEST_TOKEN,
            "X-Collector-Id": COLLECTOR_ID,
        },
        method="POST",
    )
    try:
        with urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read().decode())
            logger.info("Alarm posted: id=%s type=%s mac=%s",
                        result.get("id"), event["event_type"], event["mac_address"])
            return True
    except HTTPError as exc:
        logger.error("HTTP %d posting alarm: %s", exc.code, exc.read().decode()[:200])
        return False
    except URLError as exc:
        logger.error("Backend unreachable (%s): %s", url, exc.reason)
        return False
    except Exception as exc:
        logger.error("Unexpected error posting alarm: %s", exc)
        return False


def _enqueue_retry(event: Dict[str, Any]) -> None:
    """Append a failed alarm to the disk retry queue (bounded)."""
    with _retry_lock:
        try:
            # Bound the queue: drop oldest if at capacity.
            if os.path.exists(RETRY_QUEUE_PATH):
                with open(RETRY_QUEUE_PATH, "r", encoding="utf-8") as fh:
                    lines = fh.readlines()
                if len(lines) >= RETRY_QUEUE_MAX:
                    lines = lines[-(RETRY_QUEUE_MAX - 1):]  # keep newest
                    with open(RETRY_QUEUE_PATH, "w", encoding="utf-8") as fh:
                        fh.writelines(lines)
                    logger.warning("Retry queue full â€” dropped %d oldest entries",
                                   1 + (len(lines) - RETRY_QUEUE_MAX + 1))
            with open(RETRY_QUEUE_PATH, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(event) + "\n")
        except OSError as exc:
            logger.error("Cannot write retry queue %s: %s", RETRY_QUEUE_PATH, exc)


def post_alarm(event: Dict[str, Any]) -> bool:
    """POST to backend; on failure, enqueue for the retry-drain worker."""
    if _post_alarm_once(event):
        return True
    _enqueue_retry(event)
    logger.warning("Alarm queued for retry (mac=%s type=%s)",
                   event.get("mac_address"), event.get("event_type"))
    return False


def _drain_retry_queue_once() -> Tuple[int, int]:
    """
    Try to POST every queued alarm. Successes are removed; failures stay.
    Returns (sent, remaining).
    """
    if not os.path.exists(RETRY_QUEUE_PATH):
        return (0, 0)
    with _retry_lock:
        try:
            with open(RETRY_QUEUE_PATH, "r", encoding="utf-8") as fh:
                lines = fh.readlines()
        except OSError:
            return (0, 0)

        sent = 0
        remaining: List[str] = []
        for index, line in enumerate(lines):
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                logger.warning("Dropping malformed retry-queue line: %r", line[:80])
                continue
            if _post_alarm_once(event):
                sent += 1
            else:
                # First failure aborts further attempts this cycle to avoid
                # hammering an unreachable backend; remaining entries stay queued.
                remaining.append(json.dumps(event) + "\n")
                remaining.extend(lines[index + 1:])
                break

        try:
            if remaining:
                with open(RETRY_QUEUE_PATH, "w", encoding="utf-8") as fh:
                    fh.writelines(remaining)
            else:
                os.remove(RETRY_QUEUE_PATH)
        except OSError as exc:
            logger.error("Cannot rewrite retry queue: %s", exc)

        return (sent, len(remaining))


def _retry_drain_loop() -> None:
    """Background thread: periodically drain the retry queue."""
    logger.info("Retry-drain worker started (interval=%ds, max=%d, path=%s)",
                RETRY_INTERVAL_SEC, RETRY_QUEUE_MAX, RETRY_QUEUE_PATH)
    while True:
        try:
            sent, remaining = _drain_retry_queue_once()
            if sent or remaining:
                logger.info("Retry drain: sent=%d, remaining=%d", sent, remaining)
        except Exception as exc:
            logger.error("Retry drain error: %s", exc, exc_info=True)
        time.sleep(RETRY_INTERVAL_SEC)


# =============================================================================
# UDP TRAP SERVER
# =============================================================================

def run_trap_receiver(host: str = "0.0.0.0", port: int = 162) -> None:
    """
    Blocking UDP server loop. Receives SNMP traps, parses them, posts to backend.
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.bind((host, port))
    except PermissionError:
        logger.error("Permission denied binding to port %d. Run as root or use --port 1162", port)
        sys.exit(1)
    except OSError as exc:
        logger.error("Cannot bind to %s:%d â€” %s", host, port, exc)
        sys.exit(1)

    logger.info("SNMP Trap Receiver listening on %s:%d", host, port)
    logger.info("Forwarding alarms to: %s", BACKEND_URL)

    # Start the disk-backed retry-drain worker so alarms that failed to POST
    # while the backend was down get re-sent automatically when it comes back.
    threading.Thread(target=_retry_drain_loop, daemon=True, name="retry-drain").start()

    while True:
        try:
            data, addr = sock.recvfrom(65535)
            source_ip = addr[0]

            parsed = parse_snmp_v1_trap(data)
            if parsed is None:
                logger.warning("Could not parse trap from %s â€” raw hex: %s", source_ip, data[:32].hex())
                continue

            alarm = _classify_trap(parsed, source_ip)
            mac = alarm["mac_address"]
            event_type = alarm["event_type"]

            # Silently drop system audit traps (Telnet login notifications from OLT)
            if event_type == "SYSTEM_AUDIT":
                logger.debug("System audit trap from %s â€” ignored", source_ip)
                continue

            # Log varbind details at INFO when ONU identifier is unknown (diagnostic)
            if mac == "00:00:00:00:00:00" or event_type == "SNMP_TRAP":
                logger.info(
                    "Unidentified trap from %s: version=%s enterprise=%s generic=%s specific=%s varbinds=%d",
                    source_ip, parsed["version"], parsed["enterprise_oid"],
                    parsed["generic_trap"], parsed.get("specific_trap", -1),
                    len(parsed["varbinds"]),
                )
                for oid, t, v in parsed["varbinds"]:
                    logger.info("  varbind: %s [%s] = %s", oid, t, str(v)[:100])
            else:
                logger.debug(
                    "Trap from %s: version=%s enterprise=%s varbinds=%d",
                    source_ip, parsed["version"], parsed["enterprise_oid"], len(parsed["varbinds"]),
                )

            # Deduplication: suppress repeated traps from the same ONU within 30-minute window
            # ONU_ONLINE always passes through (recovery events must not be suppressed)
            dedup_key = f"{source_ip}:{mac}"
            now = time.time()
            if event_type != "ONU_ONLINE" and mac != "00:00:00:00:00:00":
                last_fired = _trap_dedup.get(dedup_key, 0)
                if now - last_fired < TRAP_DEDUP_WINDOW:
                    logger.debug(
                        "Trap suppressed (dedup %ds): %s %s from %s",
                        int(now - last_fired), event_type, mac, source_ip,
                    )
                    continue
                _trap_dedup[dedup_key] = now

            # Evict expired dedup entries every ~1000 traps to prevent unbounded growth
            if len(_trap_dedup) > 2000:
                cutoff = now - TRAP_DEDUP_WINDOW
                expired = [k for k, t in _trap_dedup.items() if t < cutoff]
                for k in expired:
                    del _trap_dedup[k]

            logger.info("Trap received from %s: %s mac=%s", source_ip, event_type, mac)
            post_alarm(alarm)

        except KeyboardInterrupt:
            logger.info("Interrupted â€” shutting down trap receiver")
            break
        except Exception as exc:
            logger.error("Error in trap receive loop: %s", exc, exc_info=True)
            # Small sleep to prevent tight error loop
            time.sleep(0.5)

    sock.close()


# =============================================================================
# ENTRY POINT
# =============================================================================

def main():
    parser = argparse.ArgumentParser(description="Rico Net SNMP Trap Receiver")
    parser.add_argument("--host", default="0.0.0.0", help="Bind address (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=162, help="UDP port (default: 162)")
    parser.add_argument("--backend", default=None, help="Backend URL override (e.g. http://100.x.x.x:8000)")
    parser.add_argument("--preflight", action="store_true", help="Run readiness checks and exit")
    parser.add_argument("--skip-bind-check", action="store_true", help="Skip UDP bind check during --preflight")
    args = parser.parse_args()

    if args.backend:
        global BACKEND_URL
        BACKEND_URL = args.backend.rstrip("/")
        logger.info("Backend URL overridden: %s", BACKEND_URL)

    if args.preflight:
        ok = run_preflight(host=args.host, port=args.port, skip_bind_check=args.skip_bind_check)
        sys.exit(0 if ok else 1)

    run_trap_receiver(host=args.host, port=args.port)


if __name__ == "__main__":
    main()
