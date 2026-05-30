"""
OLT Poller â€” Rico Net Phase 2
================================
Polls all OLTs every 60 seconds, pushes ONU snapshots + alarm events to backend.

Usage:
  python olt_poller.py           # runs forever (180s interval)
  python olt_poller.py --once    # single poll cycle then exit (for testing)

Environment (reads from ../.env or system env):
  BACKEND_URL     â€” backend base URL (default: http://100.x.x.x:8000)
  OLT_PROXY_TOKEN â€” required per-collector token for X-Ingest-Token header
  POLL_INTERVAL   â€” poll interval in seconds (default: 180)
"""

import argparse
import json
import logging
import os
import socket
import sqlite3
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx
from dotenv import load_dotenv

# Load .env â€” try local dir first (Pi deployment), then parent dir (dev/home PC)
_script_dir = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(_script_dir, ".env"))
load_dotenv(os.path.join(_script_dir, "..", ".env"))

from config import (
    OLT_HOSTS, OLT_TELNET_PORT, OLT_TELNET_USER, OLT_TELNET_PASSWORD, LOG_FORMAT, LOG_LEVEL,
    OLT_PRIMARY_TRANSPORT, OLT_FALLBACK_TRANSPORT, ALLOW_OLT_HARDWARE_ACCESS,
)
from olt_client import get_all_onus as _telnet_get_all_onus

# Lazy import â€” snmp_client loads snmp_oid_profile.json; no hard dep if file missing
try:
    from snmp_client import get_all_onus as _snmp_get_all_onus, has_snmp_data
    _SNMP_AVAILABLE = True
except ImportError:
    _SNMP_AVAILABLE = False
    def _snmp_get_all_onus(_host):  # type: ignore[misc]
        return []
    def has_snmp_data(_host):  # type: ignore[misc]
        return False

# Lazy import â€” web_client requires requests+beautifulsoup4 (may not be installed)
try:
    from web_client import get_all_onus as _web_get_all_onus
    _WEB_AVAILABLE = True
except ImportError:
    _WEB_AVAILABLE = False
    def _web_get_all_onus(_host):  # type: ignore[misc]
        return []

# =============================================================================
# CONFIGURATION
# =============================================================================

BACKEND_URL: str = os.getenv("BACKEND_URL", "http://100.x.x.x:8000").rstrip("/")
INGEST_TOKEN: str = os.getenv("OLT_PROXY_TOKEN", "")
INGEST_TOKEN_CONFIGURED: bool = bool(os.getenv("OLT_PROXY_TOKEN"))
POLL_INTERVAL: int = int(os.getenv("POLL_INTERVAL", "60"))
COLLECTOR_HOSTNAME: str = socket.gethostname()
COLLECTOR_ID: str = os.getenv("COLLECTOR_ID", COLLECTOR_HOSTNAME)
COLLECTOR_NAME: str = os.getenv("COLLECTOR_NAME", COLLECTOR_ID)
COLLECTOR_IP: str = (
    os.getenv("COLLECTOR_TAILSCALE_IP")
    or os.getenv("TAILSCALE_IP")
    or os.getenv("COLLECTOR_IP")
    or ""
)
COLLECTOR_VERSION: str = os.getenv("COLLECTOR_VERSION", "olt-poller-2026.04")
COLLECTOR_STARTED_AT: str = datetime.now(timezone.utc).isoformat()

# Fault detection thresholds (from CLAUDE.md signal thresholds)
RX_CRITICAL_DBM: float = -27.0   # Below this â†’ FIBER_CRITICAL alarm

# Alarm deduplication: don't re-fire the same alarm within this window (seconds)
ALARM_DEDUP_WINDOW: int = 1800   # 30 minutes

# =============================================================================
# LOGGING
# =============================================================================

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL.upper(), logging.INFO),
    format=LOG_FORMAT,
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("olt_poller")


def _hardware_access_allowed() -> bool:
    return bool(ALLOW_OLT_HARDWARE_ACCESS)


def _can_run_without_hardware(args: argparse.Namespace) -> bool:
    return bool(args.preflight and args.skip_olt_connectivity)

# =============================================================================
# OFFLINE SNAPSHOT BUFFER (SQLite â€” survives backend downtime)
# =============================================================================
# When the backend is unreachable, snapshots are written to local SQLite.
# At the start of every poll cycle we try to flush buffered batches first.
# This guarantees 30 days of uninterrupted data for the prediction engine.

_BUFFER_DB = os.getenv("SNAPSHOT_BUFFER_DB", os.path.join(_script_dir, "snapshot_buffer.db"))
_MAX_BUFFERED_BATCHES = 10_080   # 7 days Ã— 1440 polls/day â€” hard cap to protect Pi SD card


def _open_buffer_db() -> sqlite3.Connection:
    db_dir = os.path.dirname(os.path.abspath(_BUFFER_DB))
    if db_dir:
        os.makedirs(db_dir, exist_ok=True)
    return sqlite3.connect(_BUFFER_DB, timeout=20.0)


def _build_snapshot_payload(onus: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        "onus": onus,
        "collector_id": COLLECTOR_ID,
        "collector_name": COLLECTOR_NAME,
        "collector_hostname": COLLECTOR_HOSTNAME,
        "collector_ip": COLLECTOR_IP or None,
        "collector_version": COLLECTOR_VERSION,
        "collector_started_at": COLLECTOR_STARTED_AT,
        "sent_at": datetime.now(timezone.utc).isoformat(),
    }


def _build_heartbeat_payload(
    status: str,
    message: str = "",
    *,
    last_batch_total: Optional[int] = None,
    last_snapshot_at: Optional[str] = None,
) -> Dict[str, Any]:
    return {
        "collector_id": COLLECTOR_ID,
        "collector_name": COLLECTOR_NAME,
        "collector_hostname": COLLECTOR_HOSTNAME,
        "collector_ip": COLLECTOR_IP or None,
        "collector_version": COLLECTOR_VERSION,
        "collector_started_at": COLLECTOR_STARTED_AT,
        "status": status,
        "message": message,
        "backend_url": BACKEND_URL,
        "configured_olts": OLT_HOSTS,
        "last_batch_total": last_batch_total,
        "last_snapshot_at": last_snapshot_at,
        "heartbeat_at": datetime.now(timezone.utc).isoformat(),
    }


def _post_heartbeat(
    status: str,
    message: str = "",
    *,
    last_batch_total: Optional[int] = None,
    last_snapshot_at: Optional[str] = None,
) -> bool:
    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.post(
                f"{BACKEND_URL}/ingest/collector-heartbeat",
                json=_build_heartbeat_payload(
                    status,
                    message,
                    last_batch_total=last_batch_total,
                    last_snapshot_at=last_snapshot_at,
                ),
                headers=_HEADERS,
            )
        if resp.status_code == 200:
            logger.debug("Collector heartbeat posted: status=%s", status)
            return True
        logger.warning("Collector heartbeat failed: HTTP %d", resp.status_code)
        return False
    except Exception as exc:
        logger.warning("Collector heartbeat could not reach backend: %s", exc)
        return False


def _init_buffer_db() -> None:
    """Create the buffer table if it doesn't exist."""
    conn = _open_buffer_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS buffered_snapshots (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            payload    TEXT    NOT NULL,
            queued_at  TEXT    NOT NULL
        )
    """)
    conn.commit()
    conn.close()


def _buffer_snapshots(onus: List[Dict[str, Any]]) -> None:
    """Write a snapshot batch to local SQLite when backend is unreachable."""
    payload = json.dumps(_build_snapshot_payload(onus))
    queued_at = datetime.now(timezone.utc).isoformat()
    conn = _open_buffer_db()
    conn.execute(
        "INSERT INTO buffered_snapshots (payload, queued_at) VALUES (?, ?)",
        (payload, queued_at),
    )
    # Enforce hard cap â€” drop oldest if exceeded
    conn.execute(f"""
        DELETE FROM buffered_snapshots
        WHERE id NOT IN (
            SELECT id FROM buffered_snapshots
            ORDER BY id DESC
            LIMIT {_MAX_BUFFERED_BATCHES}
        )
    """)
    conn.commit()
    count = conn.execute("SELECT COUNT(*) FROM buffered_snapshots").fetchone()[0]
    conn.close()
    logger.warning("Backend unreachable â€” batch buffered locally (%d batches queued)", count)


def _flush_buffer() -> None:
    """
    Try to send buffered batches to the backend (oldest first).
    Stops as soon as one POST fails (backend still down).
    Called at the START of every poll cycle.
    """
    conn = _open_buffer_db()
    rows = conn.execute(
        "SELECT id, payload FROM buffered_snapshots ORDER BY id ASC LIMIT 5"
    ).fetchall()
    conn.close()

    if not rows:
        return

    logger.info("Flushing %d buffered snapshot batches to backend...", len(rows))
    for row_id, payload in rows:
        try:
            with httpx.Client(timeout=45.0) as client:
                resp = client.post(
                    f"{BACKEND_URL}/ingest/onu-snapshots",
                    content=payload,
                    headers=_HEADERS,
                )
            if resp.status_code == 200:
                conn2 = _open_buffer_db()
                conn2.execute("DELETE FROM buffered_snapshots WHERE id = ?", (row_id,))
                conn2.commit()
                conn2.close()
                logger.info("Flushed buffered batch id=%d", row_id)
            else:
                logger.error("Flush failed HTTP %d â€” stopping flush", resp.status_code)
                break
        except Exception as exc:
            logger.warning("Backend still unreachable during flush: %s", exc)
            break   # backend still down â€” try again next cycle


# =============================================================================
# BANDWIDTH DELTA STATE (in-memory, resets on service restart)
# =============================================================================

# Maps mac_address -> {"rx": int, "tx": int, "ts": float}
_prev_bytes: Dict[str, Dict] = {}


def _apply_byte_deltas(onus: List[Dict[str, Any]]) -> None:
    """
    Convert cumulative rx/tx byte counters (from OLT statistics) to per-poll deltas.
    Mutates each ONU dict in-place, adding rx_bytes_delta and tx_bytes_delta.
    Guards against OLT counter reset (reboot) by treating huge deltas as zero.
    """
    now = time.time()
    MAX_DELTA = 10_000_000_000  # 10 GB â€” counter reset if exceeded

    for onu in onus:
        mac = onu.get("mac_address")
        rx_cum = onu.pop("rx_bytes_cumulative", None)
        tx_cum = onu.pop("tx_bytes_cumulative", None)

        if mac is None or rx_cum is None:
            continue

        if mac in _prev_bytes:
            prev = _prev_bytes[mac]
            rx_delta = max(0, rx_cum - prev["rx"])
            tx_delta = max(0, (tx_cum or 0) - prev["tx"])
            # Discard counter-reset spikes
            if rx_delta > MAX_DELTA:
                rx_delta = 0
            if tx_delta > MAX_DELTA:
                tx_delta = 0
            onu["rx_bytes_delta"] = rx_delta
            onu["tx_bytes_delta"] = tx_delta

        _prev_bytes[mac] = {"rx": rx_cum, "tx": tx_cum or 0, "ts": now}


# =============================================================================
# OPTICAL ENRICHMENT (SNMP â†’ Telnet merge)
# =============================================================================

def _merge_optical(snmp_onus: List[Dict[str, Any]],
                   telnet_onus: List[Dict[str, Any]]) -> None:
    """
    Merge Telnet optical fields into SNMP ONU dicts in-place, keyed by (port_num, onu_index).
    MAC-based join fails because Telnet stores pon_port as "0/1" while SNMP stores "1".
    Normalizing to int port_num avoids the format mismatch.
    SNMP provides: status, MAC, traffic counters, pon_port, onu_index.
    Telnet provides: rx_power_dbm, tx_power_dbm, temperature_c, voltage_mv, dying_gasp.
    """
    def _port_key(o: Dict) -> Optional[Tuple[int, int]]:
        port = o.get("pon_port")
        idx  = o.get("onu_index")
        if port is None or idx is None:
            return None
        port_str = str(port)
        # Telnet: "0/1" â†’ 1   SNMP: "1" â†’ 1
        port_num = int(port_str.split("/")[-1]) if "/" in port_str else int(port_str)
        return (port_num, int(idx))

    telnet_map: Dict[Tuple[int, int], Dict] = {}
    for o in telnet_onus:
        key = _port_key(o)
        if key:
            telnet_map[key] = o

    matched = 0
    for onu in snmp_onus:
        key = _port_key(onu)
        t = telnet_map.get(key) if key else None
        if t:
            onu["rx_power_dbm"]  = t.get("rx_power_dbm")
            onu["tx_power_dbm"]  = t.get("tx_power_dbm")
            onu["temperature_c"] = t.get("temperature_c")
            onu["voltage_mv"]    = t.get("voltage_mv")
            onu["dying_gasp"]    = t.get("dying_gasp", False)
            matched += 1
    logger.info("Optical merge: %d/%d SNMPONUs enriched from Telnet", matched, len(snmp_onus))


# =============================================================================
# ALARM DEDUPLICATION STATE (persisted across restarts)
# =============================================================================

_DEDUP_STATE_FILE = os.path.join(_script_dir, ".dedup_state.json")

# Maps (mac_address, event_type) â†’ wall-clock epoch timestamp of last fire
_alarm_last_fired: Dict[Tuple[str, str], float] = {}


def _load_dedup_state() -> None:
    """Load dedup state from disk on startup â€” survives systemd restarts."""
    global _alarm_last_fired
    try:
        if os.path.exists(_DEDUP_STATE_FILE):
            with open(_DEDUP_STATE_FILE) as f:
                raw = json.load(f)
            # Keys are stored as "mac||event_type" strings
            now_wall = time.time()
            _alarm_last_fired = {
                tuple(k.split("||", 1)): v   # type: ignore[misc]
                for k, v in raw.items()
                if now_wall - v < ALARM_DEDUP_WINDOW   # discard expired entries
            }
            logger.info("dedup: loaded %d entries from disk", len(_alarm_last_fired))
    except Exception as exc:
        logger.warning("dedup: could not load state file: %s", exc)
        _alarm_last_fired = {}


def _save_dedup_state() -> None:
    """Persist dedup state to disk after each poll cycle."""
    try:
        with open(_DEDUP_STATE_FILE, "w") as f:
            json.dump(
                {"||".join(k): v for k, v in _alarm_last_fired.items()},
                f,
            )
    except Exception as exc:
        logger.warning("dedup: could not save state file: %s", exc)


def _should_fire_alarm(mac: str, event_type: str) -> bool:
    """Return True if this alarm should fire (not in dedup window)."""
    key = (mac, event_type)
    now = time.time()   # wall-clock so it persists correctly across restarts
    last = _alarm_last_fired.get(key, 0.0)
    if now - last >= ALARM_DEDUP_WINDOW:
        _alarm_last_fired[key] = now
        return True
    return False


def _clear_alarm_state(mac: str, event_type: str) -> None:
    """Remove dedup entry when fault clears (ONU comes back online)."""
    _alarm_last_fired.pop((mac, event_type), None)


# =============================================================================
# HTTP HELPERS
# =============================================================================

_HEADERS = {
    "Content-Type": "application/json",
    "X-Ingest-Token": INGEST_TOKEN,
    "X-Collector-Id": COLLECTOR_ID,
}


def _post_snapshots(onus: List[Dict[str, Any]]) -> bool:
    """
    POST ONU snapshot batch to backend.
    On failure: buffer locally so no data is lost.
    Returns True on successful delivery to backend.
    """
    payload = _build_snapshot_payload(onus)
    try:
        with httpx.Client(timeout=45.0) as client:
            resp = client.post(f"{BACKEND_URL}/ingest/onu-snapshots", json=payload, headers=_HEADERS)
        if resp.status_code == 200:
            data = resp.json()
            logger.info("Snapshots ingested: %d rows, polled_at=%s", data.get("inserted", 0), data.get("polled_at"))
            return True
        else:
            logger.error("Snapshot ingest failed: HTTP %d â€” buffering locally", resp.status_code)
            _buffer_snapshots(onus)
            return False
    except (httpx.ConnectError, httpx.TimeoutException) as exc:
        logger.error("Backend unreachable (%s) â€” buffering %d ONUs locally", type(exc).__name__, len(onus))
        _buffer_snapshots(onus)
        return False
    except Exception as exc:
        logger.error("Unexpected error posting snapshots: %s â€” buffering locally", exc)
        _buffer_snapshots(onus)
        return False


def _post_alarm(mac_address: str, event_type: str, olt_host: str,
                pon_port: str, onu_index: int, payload: Dict[str, Any]) -> bool:
    """POST a single alarm event to backend. Returns True on success."""
    body = {
        "mac_address": mac_address,
        "event_type": event_type,
        "olt_host": olt_host,
        "pon_port": pon_port,
        "onu_index": onu_index,
        "payload": payload,
        "received_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    try:
        with httpx.Client(timeout=45.0) as client:
            resp = client.post(f"{BACKEND_URL}/ingest/alarm-event", json=body, headers=_HEADERS)
        if resp.status_code in (200, 201):
            data = resp.json()
            logger.info("Alarm recorded: id=%s type=%s mac=%s", data.get("id"), event_type, mac_address)
            return True
        else:
            logger.error("Alarm ingest failed: HTTP %d â€” %s", resp.status_code, resp.text[:200])
            return False
    except httpx.ConnectError:
        logger.error("Backend unreachable at %s (alarm)", BACKEND_URL)
        return False
    except httpx.TimeoutException:
        logger.error("Backend timeout posting alarm")
        return False
    except Exception as exc:
        logger.error("Unexpected error posting alarm: %s", exc)
        return False


def _print_preflight_result(ok: bool, name: str, message: str) -> None:
    label = "PASS" if ok else "FAIL"
    print(f"[{label}] {name} - {message}")


def _buffer_queue_count() -> int:
    _init_buffer_db()
    conn = _open_buffer_db()
    try:
        return int(conn.execute("SELECT COUNT(*) FROM buffered_snapshots").fetchone()[0])
    finally:
        conn.close()


def _check_backend_health() -> Tuple[bool, str]:
    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.get(f"{BACKEND_URL}/healthz")
        if resp.status_code != 200:
            return False, f"HTTP {resp.status_code}"
        data = resp.json()
        if data.get("status") != "ok":
            return False, f"unexpected response: {data}"
        return True, "backend /healthz is ok"
    except Exception as exc:
        return False, str(exc)


def _check_ingest_token() -> Tuple[bool, str]:
    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.get(f"{BACKEND_URL}/ingest/verify", headers=_HEADERS)
        if resp.status_code != 200:
            return False, f"HTTP {resp.status_code}: {resp.text[:160]}"
        data = resp.json()
        if data.get("status") != "ok":
            return False, f"unexpected response: {data}"
        return True, "ingest token accepted"
    except Exception as exc:
        return False, str(exc)


def _check_olt_tcp(host: str, timeout: float = 4.0) -> Tuple[bool, str]:
    try:
        with socket.create_connection((host, OLT_TELNET_PORT), timeout=timeout):
            return True, f"TCP {host}:{OLT_TELNET_PORT} reachable"
    except Exception as exc:
        return False, f"TCP {host}:{OLT_TELNET_PORT} failed: {exc}"


def _transport_needs_login_credentials(primary: str, fallback: str) -> bool:
    return bool({primary, fallback} & {"telnet", "web"})


def _login_credentials_configured(user: str, password: str) -> bool:
    return bool(user.strip()) and bool(password.strip())


def run_preflight(*, skip_olt_connectivity: bool = False, post_heartbeat: bool = True) -> bool:
    """
    Pi-side readiness check without polling ONU CLI data.

    Verifies config, backend reachability, ingest-token validity, local buffer
    writability, optional OLT TCP reachability, and optional heartbeat visibility.
    """
    checks: List[bool] = []

    print("Rico Net OLT collector preflight")
    print(f"backend_url={BACKEND_URL}")
    print(f"collector_id={COLLECTOR_ID}")
    print(f"collector_name={COLLECTOR_NAME}")
    print(f"collector_hostname={COLLECTOR_HOSTNAME}")
    print(f"collector_ip={COLLECTOR_IP or '(not set)'}")
    print(f"collector_version={COLLECTOR_VERSION}")
    print(f"olt_count={len(OLT_HOSTS)}")
    print(f"buffer_db={_BUFFER_DB}")
    print("")

    token_ok = INGEST_TOKEN_CONFIGURED
    token_message = "OLT_PROXY_TOKEN is configured"
    checks.append(token_ok)
    _print_preflight_result(
        token_ok,
        "env-olt-proxy-token",
        token_message if token_ok else "OLT_PROXY_TOKEN is missing; set it in the Pi environment",
    )

    hosts_ok = len(OLT_HOSTS) > 0
    checks.append(hosts_ok)
    _print_preflight_result(
        hosts_ok,
        "olt-hosts",
        ", ".join(OLT_HOSTS) if hosts_ok else "no OLT hosts configured",
    )

    needs_login_credentials = _transport_needs_login_credentials(
        OLT_PRIMARY_TRANSPORT,
        OLT_FALLBACK_TRANSPORT,
    )
    login_credentials_ok = (
        not needs_login_credentials
        or _login_credentials_configured(OLT_TELNET_USER, OLT_TELNET_PASSWORD)
    )
    checks.append(login_credentials_ok)
    _print_preflight_result(
        login_credentials_ok,
        "olt-login-credentials",
        (
            "not required by configured transports"
            if not needs_login_credentials
            else "OLT_TELNET_USER and OLT_TELNET_PASSWORD are configured"
            if login_credentials_ok
            else "OLT_TELNET_USER and OLT_TELNET_PASSWORD are required for Telnet/web fallback"
        ),
    )

    try:
        queued = _buffer_queue_count()
        checks.append(True)
        _print_preflight_result(True, "buffer-db", f"writable; queued_batches={queued}")
    except Exception as exc:
        checks.append(False)
        _print_preflight_result(False, "buffer-db", str(exc))

    ok, message = _check_backend_health()
    checks.append(ok)
    _print_preflight_result(ok, "backend-healthz", message)

    ok, message = _check_ingest_token()
    checks.append(ok)
    _print_preflight_result(ok, "ingest-token-verify", message)

    if skip_olt_connectivity:
        _print_preflight_result(True, "olt-tcp", "skipped by flag")
    else:
        for host in OLT_HOSTS:
            ok, message = _check_olt_tcp(host)
            checks.append(ok)
            _print_preflight_result(ok, f"olt-tcp-{host}", message)

    if post_heartbeat:
        heartbeat_ok = _post_heartbeat(
            "preflight",
            "Collector preflight completed",
            last_batch_total=0,
        )
        checks.append(heartbeat_ok)
        _print_preflight_result(
            heartbeat_ok,
            "collector-heartbeat",
            "posted to backend; check NOC System Health" if heartbeat_ok else "could not post heartbeat",
        )
    else:
        _print_preflight_result(True, "collector-heartbeat", "skipped by flag")

    print("")
    if all(checks):
        print("Preflight passed: collector is ready to run.")
        return True

    print("Preflight failed: fix the failed checks before starting the collector.")
    return False


# =============================================================================
# FAULT DETECTION
# =============================================================================

def _detect_and_report_faults(onus: List[Dict[str, Any]]) -> None:
    """
    Scan ONU list for fault conditions and POST alarm events (with dedup):
      - dying_gasp == True          â†’ DYING_GASP     (dedup 30min; cleared when ONU recovers)
      - rx_power_dbm < -27 dBm      â†’ FIBER_CRITICAL  (dedup 30min)

    NOTE: ONU_OFFLINE is intentionally NOT handled here.
    It is created by the backend's insert_onu_snapshots â†’ process_offline_outage
    on state transitions (onlineâ†’offline). Handling it here would create duplicate
    alarms every poll cycle and flood the alarm table (especially for GPON ONUs).
    ONUs without a mac_address are skipped (no identity to attach alarm to).
    """
    for onu in onus:
        mac = onu.get("mac_address")
        if not mac:
            continue  # can't identify this ONU

        olt_host = onu.get("olt_host", "")
        pon_port = str(onu.get("pon_port", ""))
        try:
            onu_index = int(onu.get("onu_index") or 0)
        except (TypeError, ValueError):
            logger.debug("Skipping alarm checks for %s with invalid onu_index=%r", mac, onu.get("onu_index"))
            continue

        context = {
            "rx_power_dbm": onu.get("rx_power_dbm"),
            "tx_power_dbm": onu.get("tx_power_dbm"),
            "temperature_c": onu.get("temperature_c"),
            "voltage_mv": onu.get("voltage_mv"),
            "status": onu.get("status"),
            "dying_gasp": onu.get("dying_gasp", False),
        }

        # Dying gasp â€” ONU sent power-cut signal (deduplicated; fires once per event)
        if onu.get("dying_gasp", False):
            if _should_fire_alarm(mac, "DYING_GASP"):
                logger.warning("DYING_GASP detected: mac=%s port=%s onu=%s", mac, pon_port, onu_index)
                _post_alarm(mac, "DYING_GASP", olt_host, pon_port, onu_index, context)
            else:
                logger.debug("DYING_GASP suppressed (dedup): mac=%s", mac)
            continue  # skip further checks for this ONU
        else:
            # ONU no longer in dying_gasp state â€” clear dedup so next power-cut fires fresh
            _clear_alarm_state(mac, "DYING_GASP")

        # Fiber critical signal (deduplicated)
        rx = onu.get("rx_power_dbm")
        if rx is not None and rx < RX_CRITICAL_DBM:
            if _should_fire_alarm(mac, "FIBER_CRITICAL"):
                logger.warning("FIBER_CRITICAL: mac=%s rx=%.2f dBm (threshold=%.1f)", mac, rx, RX_CRITICAL_DBM)
                _post_alarm(mac, "FIBER_CRITICAL", olt_host, pon_port, onu_index, context)
            else:
                logger.debug("FIBER_CRITICAL suppressed (dedup): mac=%s rx=%.2f", mac, rx)
        else:
            # Signal recovered â€” clear dedup so next degradation fires fresh
            _clear_alarm_state(mac, "FIBER_CRITICAL")


# =============================================================================
# POLL CYCLE
# =============================================================================

# Telnet circuit breaker â€” when an OLT's Telnet path keeps failing it can take
# 280-400s per attempt and starve the other two OLTs. After N consecutive
# failures we skip Telnet for that host for COOLDOWN_SEC seconds.
_TELNET_FAIL_THRESHOLD = int(os.getenv("OLT_TELNET_FAIL_THRESHOLD", "3"))
_TELNET_COOLDOWN_SEC = int(os.getenv("OLT_TELNET_COOLDOWN_SEC", "1800"))  # 30 min
_telnet_breaker: Dict[str, Dict[str, float]] = {}  # host â†’ {"fails": int, "open_until": ts}


def _telnet_breaker_open(host: str) -> bool:
    state = _telnet_breaker.get(host)
    if not state:
        return False
    return time.time() < state.get("open_until", 0.0)


def _telnet_record_failure(host: str) -> None:
    state = _telnet_breaker.setdefault(host, {"fails": 0.0, "open_until": 0.0})
    state["fails"] = state.get("fails", 0.0) + 1
    if state["fails"] >= _TELNET_FAIL_THRESHOLD:
        state["open_until"] = time.time() + _TELNET_COOLDOWN_SEC
        logger.error(
            "Telnet circuit-breaker OPEN for OLT %s (%d consecutive failures) â€” "
            "skipping Telnet for %ds",
            host, int(state["fails"]), _TELNET_COOLDOWN_SEC,
        )


def _telnet_record_success(host: str) -> None:
    if host in _telnet_breaker:
        _telnet_breaker.pop(host, None)


def _poll_one_host(host: str) -> List[Dict[str, Any]]:
    """
    Poll a single OLT. Transport priority: SNMP â†’ Telnet fallback.

    SNMP returns full data: status + optical + dying_gasp + traffic.
    Telnet fallback is used when SNMP returns 0 ONUs (e.g. GPON .210 timeout)
    *unless* the per-host Telnet circuit breaker is open (3 consecutive
    failures â†’ cool down for 30 min). This keeps a flapping OLT from
    blocking the parallel ThreadPoolExecutor for ~400s every cycle.
    Web portal transport is disabled â€” it stresses the OLT embedded web server.
    """
    use_snmp = (
        OLT_PRIMARY_TRANSPORT in ("snmp", "web")   # treat web as snmp now
        and _SNMP_AVAILABLE
    )

    if use_snmp:
        logger.info("Polling OLT %s via SNMP (primary)", host)
        try:
            onus = _snmp_get_all_onus(host)
        except Exception as exc:
            logger.warning("OLT %s SNMP error (%s) â€” falling back to Telnet", host, exc)
            onus = []

        if onus:
            # SNMP now returns full data including optical â€” no Telnet merge needed
            logger.info("OLT %s [SNMP]: %d ONUs (online=%d)", host, len(onus),
                        sum(1 for o in onus if o.get("status") == "online"))
            return onus

        if _telnet_breaker_open(host):
            logger.warning(
                "OLT %s SNMP returned 0 ONUs and Telnet breaker is OPEN â€” skipping cycle",
                host,
            )
            return []

        logger.warning(
            "OLT %s SNMP returned 0 ONUs â€” %s",
            host,
            "falling back to Telnet" if OLT_FALLBACK_TRANSPORT == "telnet" else "giving up",
        )
        if OLT_FALLBACK_TRANSPORT == "none":
            return []

    # ---- Telnet path (primary or fallback) -----------------------------
    if _telnet_breaker_open(host):
        logger.warning("OLT %s: Telnet breaker open â€” refusing to poll", host)
        return []

    logger.info("Polling OLT %s via Telnet (%s)", host,
                "fallback" if use_snmp else "primary")
    try:
        onus = _telnet_get_all_onus(host)
        for o in onus:
            o.setdefault("_transport", "telnet")
        logger.info("OLT %s [Telnet]: %d ONUs", host, len(onus))
        if onus:
            _telnet_record_success(host)
        else:
            _telnet_record_failure(host)
        return onus
    except Exception as exc:
        logger.error("Telnet poll %s raised: %s", host, exc)
        _telnet_record_failure(host)
        return []


def poll_once() -> bool:
    """
    Execute one full poll cycle across all configured OLT hosts IN PARALLEL.
    All 3 OLTs are polled simultaneously â€” cycle time = slowest OLT (~400s vs 750s sequential).
    Returns True if at least one OLT was polled successfully.
    """
    if not OLT_HOSTS:
        logger.error("No OLT_HOSTS configured - skipping poll")
        _post_heartbeat("config_error", "No OLT_HOSTS configured", last_batch_total=0)
        return False

    _post_heartbeat("running", "Starting poll cycle")

    # First: try to flush any batches buffered during previous backend downtime
    _flush_buffer()

    all_onus: List[Dict[str, Any]] = []
    success = False

    with ThreadPoolExecutor(max_workers=len(OLT_HOSTS)) as pool:
        futures = {pool.submit(_poll_one_host, host): host for host in OLT_HOSTS}
        for future in as_completed(futures):
            host = futures[future]
            onus = future.result()
            if not onus:
                logger.warning("OLT %s returned 0 ONUs (offline or parse error)", host)
                continue
            all_onus.extend(onus)
            success = True

    if not all_onus:
        logger.error("Poll cycle produced no ONU data â€” skipping ingest")
        _post_heartbeat("olt_error", "Poll cycle produced no ONU data", last_batch_total=0)
        return False

    # Filter to ONUs with a confirmed MAC address before ingesting
    valid_onus = [o for o in all_onus if o.get("mac_address")]
    skipped = len(all_onus) - len(valid_onus)
    if skipped:
        logger.warning("Skipping %d ONUs with no mac_address (OPM-only entries)", skipped)

    if not valid_onus:
        logger.error("No valid ONUs after MAC filter â€” skipping ingest")
        _post_heartbeat("parse_error", "No valid ONUs after MAC filter", last_batch_total=0)
        return False

    logger.info("Ingesting %d valid ONUs (%d total fetched)", len(valid_onus), len(all_onus))

    # Compute bandwidth deltas from cumulative counters
    _apply_byte_deltas(valid_onus)

    # Push snapshots to backend
    delivered = _post_snapshots(valid_onus)
    snapshot_at = datetime.now(timezone.utc).isoformat()
    _post_heartbeat(
        "idle" if delivered else "backend_unreachable",
        "Snapshot batch delivered" if delivered else "Snapshot batch buffered locally",
        last_batch_total=len(valid_onus),
        last_snapshot_at=snapshot_at if delivered else None,
    )

    # Fault detection (operates on valid_onus only)
    _detect_and_report_faults(valid_onus)

    # Persist dedup state so restarts don't re-fire suppressed alarms
    _save_dedup_state()

    return success


# =============================================================================
# ENTRY POINT
# =============================================================================

def main():
    parser = argparse.ArgumentParser(description="Rico Net OLT Poller")
    parser.add_argument(
        "--once",
        action="store_true",
        help="Run a single poll cycle then exit (useful for testing)",
    )
    parser.add_argument(
        "--preflight",
        action="store_true",
        help="Check backend, ingest token, local buffer, OLT TCP reachability, and heartbeat without polling ONU data",
    )
    parser.add_argument(
        "--skip-olt-connectivity",
        action="store_true",
        help="Skip OLT TCP checks during --preflight when testing away from the Pi network",
    )
    parser.add_argument(
        "--no-heartbeat",
        action="store_true",
        help="Do not post a collector heartbeat during --preflight",
    )
    args = parser.parse_args()

    logger.info("OLT Poller starting â€” backend=%s interval=%ds hosts=%s",
                BACKEND_URL, POLL_INTERVAL, OLT_HOSTS)
    if not _hardware_access_allowed() and not _can_run_without_hardware(args):
        logger.error(
            "SAFE MODE: refusing to contact OLT hardware. Set "
            "ALLOW_OLT_HARDWARE_ACCESS=true only on the approved OLT Engine host."
        )
        sys.exit(2)

    if args.preflight:
        ok = run_preflight(
            skip_olt_connectivity=args.skip_olt_connectivity,
            post_heartbeat=not args.no_heartbeat,
        )
        sys.exit(0 if ok else 1)

    _init_buffer_db()
    _load_dedup_state()

    if args.once:
        logger.info("--once flag set: running single poll cycle")
        ok = poll_once()
        sys.exit(0 if ok else 1)

    # Run forever
    logger.info("Running forever (Ctrl+C to stop)")
    while True:
        cycle_start = time.monotonic()
        try:
            poll_once()
        except KeyboardInterrupt:
            logger.info("Interrupted by user â€” shutting down")
            sys.exit(0)
        except Exception as exc:
            logger.error("Unexpected error in poll cycle: %s", exc, exc_info=True)

        elapsed = time.monotonic() - cycle_start
        sleep_time = max(0.0, POLL_INTERVAL - elapsed)
        logger.info("Poll cycle done in %.1fs â€” sleeping %.1fs", elapsed, sleep_time)
        try:
            time.sleep(sleep_time)
        except KeyboardInterrupt:
            logger.info("Interrupted during sleep â€” shutting down")
            sys.exit(0)


if __name__ == "__main__":
    main()
