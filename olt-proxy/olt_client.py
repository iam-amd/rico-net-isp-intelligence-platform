"""
OLT Client — Telnet/CLI for Netlink EPON and GPON OLTs

Supports:
  - EPON OLT (firmware V2.03.75R) — prompts: epon-olt> / epon-olt#
  - GPON OLT (firmware V1.4.8R / V2.3.1R) — prompts: gpon-olt> / gpon-olt#

ONU-ID format: EPON0/1:1 or GPON0/1:1 (port 0/1, ONU index 1)
MAC format:    8c:c7:c3:ea:c7:00  (standard lowercase colon)
Supply Voltage unit: Volts (multiply by 1000 to get mV)

OLT type is auto-detected from the login prompt after connecting.
"""

import re
import logging
import socket
import time
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any


def _utc_now_iso() -> str:
    """Return current UTC time as ISO 8601 with 'Z' suffix.
    Replaces broken `_utc_now_iso()` which formatted LOCAL time
    but labeled it as UTC — corrupted polled_at by 5h30m on IST hosts.
    """
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

from config import (
    OLT_HOSTS, OLT_TELNET_PORT, OLT_TELNET_USER, OLT_TELNET_PASSWORD,
    OLT_TELNET_TIMEOUT
)
from mac_normalizer import normalize_mac

logger = logging.getLogger(__name__)


class OLTTelnetClient:
    """Telnet client for Netlink EPON and GPON OLTs. Auto-detects OLT type from login prompt."""

    def __init__(self, olt_host: str):
        self.olt_host = olt_host
        self.sock = None
        self.logged_in = False
        self.olt_type = "epon"   # "epon" or "gpon" — set in connect()

    @property
    def _prompt_user(self) -> str:
        return f"{self.olt_type}-olt>"

    @property
    def _prompt_priv(self) -> str:
        return f"{self.olt_type}-olt#"

    @property
    def _onu_id_prefix(self) -> str:
        return self.olt_type.upper()  # "EPON" or "GPON"

    @property
    def _iface_cmd(self) -> str:
        return f"interface {self.olt_type} 0/1"

    # =========================================================================
    # CONNECTION
    # =========================================================================

    def connect(self) -> bool:
        """
        Full login sequence for EPON or GPON Netlink OLTs.
        OLT type (epon/gpon) is auto-detected from the first prompt received.
        """
        try:
            self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.sock.settimeout(OLT_TELNET_TIMEOUT)
            self.sock.connect((self.olt_host, OLT_TELNET_PORT))
            logger.info(f"TCP connected to {self.olt_host}:{OLT_TELNET_PORT}")

            # Wait for Login: prompt (OLT sends IAC negotiation + banner first)
            output = self._wait_for("Login:", timeout=20)
            if "Login:" not in output:
                logger.error(f"No Login: prompt in 20s. Got: {output[-80:]!r}")
                return False

            # Auto-detect OLT type from banner/prompt (gpon-olt or epon-olt)
            if "gpon-olt" in output.lower():
                self.olt_type = "gpon"
            else:
                self.olt_type = "epon"
            logger.info(f"OLT {self.olt_host}: detected type = {self.olt_type.upper()}")

            self._send(OLT_TELNET_USER)
            output = self._wait_for("Password:", timeout=15)
            if "Password:" not in output:
                logger.error(f"No Password: prompt after username. Got: {output[-80:]!r}")
                return False

            self._send(OLT_TELNET_PASSWORD)
            output = self._wait_for(self._prompt_user, timeout=15)
            if self._prompt_user not in output:
                # Some GPON firmware may not show type in banner — detect from prompt now
                if "gpon-olt>" in output:
                    self.olt_type = "gpon"
                elif "epon-olt>" not in output:
                    logger.error(f"Login failed — no user prompt. Got: {output[-80:]!r}")
                    return False

            # Enter privileged mode
            self._send("enable")
            output = self._wait_for("Password:", timeout=10)
            if "Password:" not in output:
                logger.warning(f"No enable Password: prompt — trying anyway.")
            self._send(OLT_TELNET_PASSWORD)
            output = self._wait_for(self._prompt_priv, timeout=15)

            if self._prompt_priv not in output:
                logger.error(f"Enable failed — no {self._prompt_priv} prompt. Got: {output[-80:]!r}")
                return False

            # Enter configure mode and select PON interface
            self._send("configure terminal")
            self._wait_for("config)#", timeout=10)
            self._send(self._iface_cmd)
            output = self._wait_for("config-pon", timeout=10)

            if "config-pon" not in output:
                logger.error(f"Interface mode failed ({self._iface_cmd}). Got: {output[-80:]!r}")
                return False

            self.logged_in = True
            logger.info(f"OLT {self.olt_host} ({self.olt_type.upper()}): ready in config-pon context")
            return True

        except Exception as e:
            logger.error(f"connect() failed: {e}")
            return False

    def disconnect(self):
        if self.sock:
            try:
                self._send("end")
                self._send("quit")
                self.sock.close()
            except Exception:
                pass
            self.logged_in = False
            logger.info(f"Disconnected from {self.olt_host}")

    # =========================================================================
    # LOW-LEVEL I/O
    # =========================================================================

    def _send(self, text: str):
        self.sock.sendall((text + "\n").encode())
        time.sleep(0.25)

    def _drain(self, seconds: float = 2.0) -> str:
        """Read all available data for `seconds` wall-clock time."""
        data = b""
        end = time.time() + seconds
        while time.time() < end:
            try:
                chunk = self.sock.recv(4096)
                if chunk:
                    data += chunk
            except socket.timeout:
                break
        return data.decode("utf-8", errors="ignore")

    def _wait_for(self, prompt: str, timeout: float = 15.0) -> str:
        """
        Read until `prompt` appears in accumulated output OR wall-clock timeout expires.
        Unlike _drain(), this continues receiving even if the socket recv() times out,
        so it handles OLTs that respond slowly (e.g. after firmware processing delays).
        """
        data = b""
        target = prompt.encode("utf-8")
        end = time.time() + timeout
        while time.time() < end:
            try:
                chunk = self.sock.recv(4096)
                if chunk:
                    data += chunk
                    if target in data:
                        break
            except socket.timeout:
                # Socket timeout (OLT_TELNET_TIMEOUT=10s) fired — but wall-clock may
                # still have time left, so keep looping
                continue
        return data.decode("utf-8", errors="ignore")

    def _run(self, cmd: str, wait: float = 25.0) -> str:
        """
        Send a command and read until the prompt returns.
        Handles --More-- pagination automatically.
        Drains buffer first to clear any leftover data from previous commands.
        """
        # Drain any leftover data before sending a new command
        self._drain(0.8)

        self.sock.sendall((cmd + "\n").encode())
        time.sleep(0.3)

        _PROMPT_MARKERS = (b"config-pon", b"epon-olt#", b"epon-olt>", b"gpon-olt#", b"gpon-olt>")

        data = b""
        end = time.time() + wait
        while time.time() < end:
            try:
                chunk = self.sock.recv(4096)
                if chunk:
                    data += chunk
                    if b"--More--" in data:
                        self.sock.sendall(b" ")  # page forward
                        time.sleep(0.15)
                        data = data.replace(b"--More--", b"")
                        continue
                    # Stop when prompt returns (check last 60 bytes)
                    tail = data[-60:]
                    if any(m in tail for m in _PROMPT_MARKERS):
                        time.sleep(0.3)
                        break
            except socket.timeout:
                # Socket recv timed out — OLT may be slow (large bulk output).
                # Only stop early if the end-of-command prompt is already in the buffer;
                # otherwise keep waiting up to the wall-clock limit.
                tail = data[-60:]
                if any(m in tail for m in _PROMPT_MARKERS):
                    break

        result = data.decode("utf-8", errors="ignore")
        # Strip command echo and prompt lines
        lines = result.split("\n")
        lines = [l for l in lines if cmd not in l and "config-pon" not in l
                 and "epon-olt" not in l and "gpon-olt" not in l]
        return "\n".join(lines).strip()

    # =========================================================================
    # PUBLIC API
    # =========================================================================

    def get_all_onus(self) -> List[Dict[str, Any]]:
        """
        Return all ONUs across all PON ports.
        Routes to GPON or EPON parser based on detected OLT type.
        """
        if self.olt_type == "gpon":
            return self._get_all_onus_gpon()
        return self._get_all_onus_epon()

    def _get_all_onus_gpon(self) -> List[Dict[str, Any]]:
        """
        GPON OLT — fetch all ONUs with optical signal data.

        Optical data collection (per-port loop):
          GPON firmware A (.200, V2.3.1R): show onu 1-128 optical_info
            → Returns: Rx/Tx power, Temperature, Voltage, Laser bias per ONU block
          GPON firmware B (.210, V1.4.8R): show onu N optical
            → Returns: Rx/Tx power per ONU (range syntax may also work)

        Detection: probe ONU 1 on port 0/1 — if 'Rx optical level' in result,
        determine which command format works (optical_info vs optical).

        Serial number is stored as mac_address (prefixed SN: to avoid DB collisions).
        """
        state_raw = self._run("show onu state all", wait=35.0)
        info_raw  = self._run("show onu info all",  wait=35.0)

        state_map = self._parse_gpon_state(state_raw)
        info_map  = self._parse_gpon_info(info_raw)

        # Detect which optical command works on this OLT firmware
        optical_cmd = self._detect_gpon_optical_cmd()
        logger.info(f"_get_all_onus_gpon: optical_cmd='{optical_cmd}' on {self.olt_host}")

        # Collect optical data per port
        optical_map: Dict[str, Dict] = {}
        if optical_cmd:
            # Find all unique port numbers from state data
            ports = sorted(set(key.split(":")[0] for key in state_map))
            for port in ports:
                self._run(f"interface gpon 0/{port}", wait=5.0)
                # Max ONU index for this port
                port_onu_ids = [key for key in state_map if key.startswith(f"{port}:")]
                if not port_onu_ids:
                    continue
                max_idx = max(int(k.split(":")[1]) for k in port_onu_ids)

                if optical_cmd == "optical_info":
                    # Bulk range command: returns all ONUs in one shot
                    raw = self._run(f"show onu 1-{max_idx} optical_info", wait=max_idx * 0.4 + 15.0)
                    port_data = self._parse_gpon_optical_info_bulk(raw, port)
                elif optical_cmd == "optical":
                    # Bulk range command — OLT returns blocks only for online ONUs.
                    # Pass online indices so blocks map to correct ONU IDs despite gaps.
                    online_indices = sorted(
                        int(k.split(":")[1]) for k in port_onu_ids
                        if state_map.get(k, {}).get("status") == "online"
                    )
                    raw = self._run(f"show onu 1-{max_idx} optical", wait=max_idx * 0.8 + 90.0)
                    port_data = self._parse_gpon_optical_bulk(raw, port, onu_indices=online_indices)
                else:
                    port_data = {}

                optical_map.update(port_data)
                logger.debug(f"  port 0/{port}: {len(port_data)} optical entries")

            # Restore to port 0/1 context
            self._run("interface gpon 0/1", wait=5.0)
            optical_count = len(optical_map)
            logger.info(f"_get_all_onus_gpon: collected optical data for {optical_count} ONUs from {self.olt_host}")

        all_keys = set(state_map.keys()) | set(info_map.keys())
        onus = []
        for key in all_keys:
            parts = key.split(":")
            port = parts[0] if len(parts) == 2 else "?"
            idx  = parts[1] if len(parts) == 2 else "?"

            optical = optical_map.get(key, {})

            entry = {
                "olt_host":  self.olt_host,
                "polled_at": _utc_now_iso(),
                "pon_port":  f"0/{port}",
                "onu_index": int(idx) if idx.isdigit() else 0,
                "rx_power_dbm":  optical.get("rx_power_dbm"),
                "tx_power_dbm":  optical.get("tx_power_dbm"),
                "temperature_c": optical.get("temperature_c"),
                "voltage_mv":    optical.get("voltage_mv"),
            }
            entry.update(state_map.get(key, {"status": "offline", "dying_gasp": False}))
            entry.update(info_map.get(key, {}))

            sn = entry.get("serial_number")
            if sn:
                entry["mac_address"] = f"SN:{sn}"
            else:
                entry["mac_address"] = f"GPON{port}:{idx}"

            onus.append(entry)

        optical_count = sum(1 for o in onus if o.get("rx_power_dbm") is not None)
        logger.info(f"_get_all_onus_gpon: {len(onus)} ONUs, {optical_count} with optical data from {self.olt_host}")
        return onus

    def _detect_gpon_optical_cmd(self) -> Optional[str]:
        """
        Probe which optical command this GPON firmware supports.
        Returns: 'optical_info' | 'optical' | None

        GPON firmware A (V2.3.1R, e.g. .200): show onu N optical_info
          → Output contains 'Rx optical level: -XX.XXX(dBm)'
        GPON firmware B (V1.4.8R, e.g. .210): show onu N optical
          → Output contains 'Rx optical level(ONU) : -XX.XX'
        """
        # Enter port 0/1 to test
        self._run("interface gpon 0/1", wait=5.0)

        # Test optical_info first (firmware A)
        raw_info = self._run("show onu 1 optical_info", wait=10.0)
        if re.search(r"Rx optical level.*[-\d.]+.*dBm", raw_info, re.IGNORECASE):
            logger.info(f"_detect_gpon_optical_cmd: 'optical_info' works on {self.olt_host}")
            return "optical_info"

        # Test optical (firmware B)
        raw_opt = self._run("show onu 1 optical", wait=10.0)
        if re.search(r"Rx optical level.*[-\d.]+", raw_opt, re.IGNORECASE):
            logger.info(f"_detect_gpon_optical_cmd: 'optical' works on {self.olt_host}")
            return "optical"

        logger.warning(f"_detect_gpon_optical_cmd: no optical command found on {self.olt_host}")
        return None

    def _get_all_onus_epon(self) -> List[Dict[str, Any]]:
        """
        EPON OLT — original fetch logic using EPON-specific CLI commands.
        """
        opm   = self._parse_opm_diag(self._run("show onu opm-diag all"))
        auth  = self._parse_auth_info(self._run("show onu auth-info all"))
        stats = self._parse_statistics(self._run("show onu statistics all"))
        basic = self._parse_basic_info(self._run("show onu basic-info all"))

        onus = []
        # Merge on ONU-ID
        all_ids = set(opm.keys()) | set(auth.keys())
        for onu_id in all_ids:
            entry = {"olt_host": self.olt_host, "polled_at": _utc_now_iso()}
            entry.update(opm.get(onu_id, {}))
            entry.update(auth.get(onu_id, {}))
            # Cumulative bytes (poller converts to delta)
            if onu_id in stats:
                entry["rx_bytes_cumulative"] = stats[onu_id]["rx_bytes"]
                entry["tx_bytes_cumulative"] = stats[onu_id]["tx_bytes"]
            # Device inventory
            if onu_id in basic:
                entry.update(basic[onu_id])
            # Parse pon_port and onu_index from ONU-ID (EPON0/1:3 or GPON0/1:3)
            m = re.match(r"(?:EPON|GPON)(\d+/\d+):(\d+)", onu_id, re.IGNORECASE)
            if m:
                entry["pon_port"] = m.group(1)
                entry["onu_index"] = int(m.group(2))
            onus.append(entry)

        logger.info(f"_get_all_onus_epon: {len(onus)} ONUs from {self.olt_host}")
        return onus

    # =========================================================================
    # GPON PARSERS
    # =========================================================================

    def _parse_gpon_detail_info(self, output: str) -> Dict[str, Dict]:
        """
        Parse 'show onu detail-info all' output for GPON OLT.
        Some firmware variants include optical power inline per ONU block:

        Example block format:
          ONU-ID: GPON0/1:3
          ...
          Rx Optical Power: -18.50 dBm
          Tx Optical Power: 2.00 dBm
          Temperature: 45.00 C
          Voltage: 3.30 V

        Returns dict keyed by ONU-ID (uppercase, e.g. "GPON0/1:3").
        """
        result = {}
        current_id = None
        current = {}
        for line in output.split("\n"):
            line = re.sub(r"[\x00-\x1f\x7f]+", " ", line).strip()
            # New ONU block header
            m_id = re.search(r"(?:ONU-ID|ONU_ID|ONU\s+ID)[:\s]+((GPON|EPON)\d+/\d+:\d+)", line, re.IGNORECASE)
            if m_id:
                if current_id and current:
                    result[current_id] = current
                current_id = m_id.group(1).upper()
                current = {}
                continue
            if current_id is None:
                continue
            # Rx power
            m = re.search(r"[Rr]x\s*[Oo]ptical\s*[Pp]ower[:\s]+([-\d.]+)", line)
            if m:
                current["rx_power_dbm"] = float(m.group(1))
            # Tx power
            m = re.search(r"[Tt]x\s*[Oo]ptical\s*[Pp]ower[:\s]+([-\d.]+)", line)
            if m:
                current["tx_power_dbm"] = float(m.group(1))
            # Temperature
            m = re.search(r"[Tt]emperature[:\s]+([\d.]+)", line)
            if m:
                current["temperature_c"] = float(m.group(1))
            # Voltage
            m = re.search(r"[Vv]oltage[:\s]+([\d.]+)\s*[Vv]", line)
            if m:
                current["voltage_mv"] = int(float(m.group(1)) * 1000)
        if current_id and current:
            result[current_id] = current
        logger.debug(f"_parse_gpon_detail_info: {len(result)} entries")
        return result

    def _parse_gpon_optical_info_bulk(self, output: str, port: str) -> Dict[str, Dict]:
        """
        Parse 'show onu 1-N optical_info' output from GPON firmware A (V2.3.1R).

        Each ONU block looks like:
          ONU ID: 1
          ONU PON Interface: pon_0/1
          ...
          Rx optical level: -11.494(dBm)
          Tx optical level: 2.252(dBm)
          Power feed voltage: 3.34(V)
          Laser bias current: 17.162(mA)
          Temperature: 76.098(C)

        Keyed by "port:onu_idx" e.g. "1:3".
        Offline ONUs have N/A values — those are skipped (no optical data).
        """
        result: Dict[str, Dict] = {}
        current_idx: Optional[int] = None
        current: Dict = {}

        for raw_line in output.split("\n"):
            # Strip CSI escape codes (e.g. \x1b[30C = cursor right 30) and control chars
            line = re.sub(r"\x1b\[[\d;]*[A-Za-z]", "", raw_line)
            line = re.sub(r"[\x00-\x1f\x7f]", "", line).strip()
            if not line:
                continue

            # New ONU block starts with "ONU ID: N"
            m_id = re.match(r"ONU\s+ID\s*:\s*(\d+)", line, re.IGNORECASE)
            if m_id:
                # Save previous ONU
                if current_idx is not None and current:
                    result[f"{port}:{current_idx}"] = current
                current_idx = int(m_id.group(1))
                current = {}
                continue

            if current_idx is None:
                continue

            # Rx optical level: -11.494(dBm)  or  N/A
            m = re.search(r"Rx optical level\s*:\s*([-\d.]+)", line, re.IGNORECASE)
            if m and m.group(1) != "N/A":
                current["rx_power_dbm"] = float(m.group(1))
                continue

            # Tx optical level: 2.252(dBm)
            m = re.search(r"Tx optical level\s*:\s*([-\d.]+)", line, re.IGNORECASE)
            if m and m.group(1) != "N/A":
                current["tx_power_dbm"] = float(m.group(1))
                continue

            # Temperature: 76.098(C)
            m = re.search(r"Temperature\s*:\s*([\d.]+)", line, re.IGNORECASE)
            if m and float(m.group(1)) != 0.0:
                current["temperature_c"] = float(m.group(1))
                continue

            # Power feed voltage: 3.34(V)
            m = re.search(r"Power feed voltage\s*:\s*([\d.]+)", line, re.IGNORECASE)
            if m and float(m.group(1)) != 0.0:
                current["voltage_mv"] = int(float(m.group(1)) * 1000)
                continue

            # Laser bias current: 17.162(mA)
            m = re.search(r"Laser bias current\s*:\s*([\d.]+)", line, re.IGNORECASE)
            if m:
                current["laser_bias_ma"] = float(m.group(1))
                continue

        # Save last block
        if current_idx is not None and current:
            result[f"{port}:{current_idx}"] = current

        logger.debug(f"_parse_gpon_optical_info_bulk: {len(result)} entries for port {port}")
        return result

    def _parse_gpon_optical_single(self, output: str) -> Optional[Dict]:
        """
        Parse 'show onu N optical' output from GPON firmware B (V1.4.8R).

        Output looks like:
          Alarm                      : enable
          Piggyback DBA rpt mode     : mode 0 only
          Rx optical level(ONU)      : -27.21
          Tx optical level           : 2.07
          ONU response time          : 0

        Returns dict with rx_power_dbm, tx_power_dbm or None if no data.
        """
        result: Dict = {}

        # Strip CSI codes
        output = re.sub(r"\x1b\[[\d;]*[A-Za-z]", "", output)
        output = re.sub(r"[\x00-\x1f\x7f]", "", output)

        m = re.search(r"Rx optical level\s*(?:\(ONU\))?\s*:\s*([-\d.]+)", output, re.IGNORECASE)
        if m:
            result["rx_power_dbm"] = float(m.group(1))

        m = re.search(r"Tx optical level\s*:\s*([-\d.]+)", output, re.IGNORECASE)
        if m:
            result["tx_power_dbm"] = float(m.group(1))

        # Some firmware variants also include temperature and voltage
        m = re.search(r"Temperature\s*:\s*([\d.]+)", output, re.IGNORECASE)
        if m and float(m.group(1)) not in (0.0, None):
            result["temperature_c"] = float(m.group(1))

        m = re.search(r"[Vv]oltage\s*:\s*([\d.]+)", output, re.IGNORECASE)
        if m and float(m.group(1)) not in (0.0, None):
            result["voltage_mv"] = int(float(m.group(1)) * 1000)

        return result if result else None

    def _parse_gpon_optical_bulk(self, output: str, port: str,
                                 onu_indices: Optional[List[int]] = None,
                                 start_idx: int = 1) -> Dict[str, Dict]:
        """
        Parse 'show onu 1-N optical' bulk output from GPON firmware B (V1.4.8R).

        Each ONU block starts with 'Alarm :'. No ONU ID header — blocks are
        in sequential order matching the requested ONU list.

        onu_indices: if provided, maps block N to onu_indices[N] instead of
          sequential from start_idx. Pass the sorted online ONU indices for
          this port to correctly handle gaps in ONU registration (offline ONUs
          are silently skipped by the OLT in the range output).

        Keyed by "port:onu_idx" e.g. "1:3".
        """
        result: Dict[str, Dict] = {}

        # Strip CSI escape codes and backspace/null bytes (keep \n, \r)
        output = re.sub(r"\x1b\[[\d;]*[A-Za-z]", "", output)
        output = re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", "", output)

        # Split into ONU blocks at each "Alarm :" line
        blocks = re.split(r"(?:^|\r?\n)\s*Alarm\s+:", output, flags=re.IGNORECASE)
        # First element is any pre-Alarm header text — skip it

        idx_sequence = onu_indices if onu_indices else list(range(start_idx, start_idx + len(blocks)))

        for block_num, block in enumerate(blocks[1:]):
            if block_num >= len(idx_sequence):
                break  # more blocks than expected indices — stop
            onu_idx = idx_sequence[block_num]

            data: Dict = {}

            m = re.search(r"Rx optical level\s*(?:\(ONU\))?\s*:\s*([-\d.]+)", block, re.IGNORECASE)
            if m:
                data["rx_power_dbm"] = float(m.group(1))

            m = re.search(r"Tx optical level\s*:\s*([-\d.]+)", block, re.IGNORECASE)
            if m:
                data["tx_power_dbm"] = float(m.group(1))

            m = re.search(r"Temperature\s*:\s*([\d.]+)", block, re.IGNORECASE)
            if m and float(m.group(1)) != 0.0:
                data["temperature_c"] = float(m.group(1))

            m = re.search(r"Power feed voltage\s*:\s*([\d.]+)", block, re.IGNORECASE)
            if m and float(m.group(1)) != 0.0:
                data["voltage_mv"] = int(float(m.group(1)) * 1000)

            m = re.search(r"Laser bias current\s*:\s*([\d.]+)", block, re.IGNORECASE)
            if m:
                data["laser_bias_ma"] = float(m.group(1))

            if data:
                result[f"{port}:{onu_idx}"] = data

        logger.debug(f"_parse_gpon_optical_bulk: {len(result)} entries for port {port}")
        return result

    def _parse_gpon_state(self, output: str) -> Dict[str, Dict]:
        """
        Parse 'show onu state all' output for GPON OLT.
        Supports two firmware formats:
          - Firmware A (.200): ONU-ID as  1/1/X:N   (slot/card/port:onu_index)
          - Firmware B (.210): ONU-ID as  GPON0/X:N (prefix/port:onu_index)
        We key by "X:N" (port:onu_index) to match _parse_gpon_info.

        Columns: OnuIndex | Admin State | OMCC State | Phase State | Channel/SN
        Phase State values: working | OffLine | DyingGasp | LOS | logging | deactivated
        """
        result = {}
        for line in output.split("\n"):
            # Strip ANSI CSI escape sequences (e.g. ESC[12C) without eating adjacent digits
            line = re.sub(r"\x1b\[[\d;]*[A-Za-z]", " ", line)
            # Strip remaining control characters
            line = re.sub(r"[\x00-\x1f\x7f]", "", line)
            line = re.sub(r"\s+", " ", line).strip()
            # Match both formats: "1/1/PORT:IDX" (firmware A) or "GPON0/PORT:IDX" (firmware B)
            m = re.match(r"(?:1/1/|GPON\d+/)(\d+):(\d+)\s+(\S+)\s+(\S+)\s+(\S+)", line, re.IGNORECASE)
            if m:
                port      = m.group(1)
                onu_idx   = m.group(2)
                phase_raw = m.group(5)   # e.g. "working", "OffLine", "DyingGasp", "LOS"
                phase     = phase_raw.lower()
                key       = f"{port}:{onu_idx}"
                dying_g   = "dyinggasp" in phase
                status    = "online" if phase == "working" else "offline"
                result[key] = {"status": status, "dying_gasp": dying_g}
        logger.debug(f"_parse_gpon_state: {len(result)} entries")
        return result

    def _parse_gpon_info(self, output: str) -> Dict[str, Dict]:
        """
        Parse 'show onu info all' output for GPON OLT.
        ONU-ID format: GPON0/X:N
        We key by "X:N" to match _parse_gpon_state.

        Columns: OnuIndex | Model | Profile | Mode | AuthInfo (serial number)
        """
        result = {}
        for line in output.split("\n"):
            line = re.sub(r"[\x00-\x1f\x7f]", "", line)
            line = re.sub(r"\[\d+[A-Z]", " ", line)
            line = re.sub(r"\s+", " ", line).strip()
            # Match GPON0/X:N pattern
            m = re.match(r"GPON\d+/(\d+):(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)", line, re.IGNORECASE)
            if m:
                port   = m.group(1)
                idx    = m.group(2)
                model  = m.group(3)
                sn     = m.group(6)  # AuthInfo column = serial number
                key    = f"{port}:{idx}"
                result[key] = {"serial_number": sn, "model_id": model}
        logger.debug(f"_parse_gpon_info: {len(result)} entries")
        return result

    def get_onu_fast(self, pon_port: str, onu_index: int) -> Optional[Dict[str, Any]]:
        """
        Targeted single-ONU fetch using per-port CLI commands.

        Switches to the target port context so 'show onu ... all' scopes to
        that port only (~45 ONUs instead of 1,288). For GPON, uses single-ONU
        optical commands.

        Target latency: <10s for EPON, <15s for GPON.
        Compare to get_onu_by_port() which runs full OLT scans (30-400s).
        """
        port_num = str(pon_port).split("/")[-1]
        onu_id_key = f"{self._onu_id_prefix}0/{port_num}:{onu_index}".upper()

        t0 = time.time()
        entry: Dict[str, Any] = {
            "olt_host":  self.olt_host,
            "pon_port":  f"0/{port_num}",
            "onu_index": onu_index,
            "polled_at": _utc_now_iso(),
        }

        # Switch to target port context
        self._run(f"interface {self.olt_type} 0/{port_num}", wait=5.0)

        if self.olt_type == "epon":
            # In port context, 'show onu ... all' scopes to this port only
            opm_raw  = self._run("show onu opm-diag all",  wait=30.0)
            auth_raw = self._run("show onu auth-info all", wait=30.0)

            opm  = self._parse_opm_diag(opm_raw)
            auth = self._parse_auth_info(auth_raw)

            if onu_id_key not in opm and onu_id_key not in auth:
                logger.warning("get_onu_fast: %s not found in EPON output", onu_id_key)
                return None

            entry.update(opm.get(onu_id_key, {}))
            entry.update(auth.get(onu_id_key, {}))

        else:  # gpon
            # Single-ONU optical: try firmware A (optical_info) then firmware B (optical)
            optical: Optional[Dict] = None
            raw_a = self._run(f"show onu {onu_index} optical_info", wait=15.0)
            if re.search(r"Rx optical level.*[-\d.]", raw_a, re.IGNORECASE):
                optical = self._parse_gpon_optical_single(raw_a)
            else:
                raw_b = self._run(f"show onu {onu_index} optical", wait=15.0)
                if re.search(r"Rx optical level.*[-\d.]", raw_b, re.IGNORECASE):
                    optical = self._parse_gpon_optical_single(raw_b)

            if optical:
                entry.update(optical)

            # Single-ONU state: 'show onu state N' returns just this ONU's row (~10s vs ~30s for all)
            # 'show onu info all' skipped — serial number doesn't change, backend already has it
            state_raw = self._run(f"show onu state {onu_index}", wait=15.0)
            state_map = self._parse_gpon_state(state_raw)

            state_key = f"{port_num}:{onu_index}"
            if state_key not in state_map:
                logger.warning("get_onu_fast: %s not in GPON state map", state_key)
                return None

            entry.update(state_map[state_key])
            # mac_address placeholder — backend uses onu_latest.mac_address, not this value
            entry["mac_address"] = f"GPON{port_num}:{onu_index}"

        elapsed = time.time() - t0
        logger.info("get_onu_fast: %s 0/%s:%d → %.1fs", self.olt_host, port_num, onu_index, elapsed)
        return entry

    def get_onu_by_mac(self, mac_address: str) -> Optional[Dict[str, Any]]:
        """
        Find a single ONU by MAC address.
        Scans auth-info output for MAC, then enriches with optical data.
        """
        target = normalize_mac(mac_address).lower()

        auth  = self._parse_auth_info(self._run("show onu auth-info all"))
        opm   = self._parse_opm_diag(self._run("show onu opm-diag all"))

        # Find the ONU-ID for this MAC
        onu_id = None
        for uid, info in auth.items():
            if info.get("mac_address", "").lower() == target:
                onu_id = uid
                break

        if not onu_id:
            logger.warning(f"MAC {mac_address} not found in auth-info output")
            return None

        entry = {"olt_host": self.olt_host, "mac_address": normalize_mac(mac_address),
                 "polled_at": _utc_now_iso()}
        entry.update(opm.get(onu_id, {}))
        entry.update(auth.get(onu_id, {}))

        m = re.match(r"(?:EPON|GPON)(\d+/\d+):(\d+)", onu_id, re.IGNORECASE)
        if m:
            entry["pon_port"] = m.group(1)
            entry["onu_index"] = int(m.group(2))

        return entry

    def reboot_onu(self, pon_port: str, onu_index: int) -> bool:
        """
        Reboot an ONU by PON port and index.
        Sends: reboot onu <pon_port> <onu_index>
        """
        try:
            response = self._run(f"reboot onu {pon_port} {onu_index}", wait=6)
            success = any(k in response.lower() for k in ["success", "reboot", "ok"])
            logger.info(f"reboot_onu PON {pon_port} ONU {onu_index}: {success}")
            return success
        except Exception as e:
            logger.error(f"reboot_onu failed: {e}")
            return False

    # =========================================================================
    # PARSERS
    # =========================================================================

    def _parse_opm_diag(self, output: str) -> Dict[str, Dict]:
        """
        Parse 'show onu opm-diag all' output.
        Columns: ONU-ID | Temp(C) | Voltage(V) | TX Bias(mA) | TX Power(dBm) | RX Power(dBm)

        Example:
          EPON0/1:1   38.29   3.46   13.15   2.23   -16.07
        """
        result = {}
        for line in output.split("\n"):
            line = re.sub(r"[\x00-\x1f\x7f]+", " ", line).strip()
            # Match ONU-ID at start of line
            m = re.match(r"((?:EPON|GPON)\d+/\d+:\d+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([+-]?[\d.]+)\s+([+-]?[\d.]+)", line, re.IGNORECASE)
            if m:
                onu_id = m.group(1).upper()
                result[onu_id] = {
                    "temperature_c":  float(m.group(2)),
                    "voltage_mv":     int(float(m.group(3)) * 1000),  # V -> mV
                    "tx_power_dbm":   float(m.group(5)),
                    "rx_power_dbm":   float(m.group(6)),
                }
        logger.debug(f"_parse_opm_diag: {len(result)} entries")
        return result

    def _parse_statistics(self, output: str) -> Dict[str, Dict]:
        """
        Parse 'show onu statistics all' output.
        Columns: ONU-ID | Status | MAC Address | LastStatsTime |
                 rxOctets | rxUcastFrames | rxMcastFrames | rxBcastFrames | rxBadCrc32 | txOctets | ...

        Returns cumulative byte counters keyed by ONU-ID.
        Handles firmware variants: date/time field may be present (YYYY/MM/DD HH:MM:SS),
        absent, or replaced with N/A. We extract all number tokens after the MAC and
        use nums[0]=rxOctets, nums[5]=txOctets (or best guess when columns merge).
        """
        result = {}
        for line in output.split("\n"):
            line = re.sub(r"[\x00-\x1f\x7f]+", " ", line).strip()
            # Match ONU-ID + status + MAC — the date/time field is optional
            m = re.match(
                r"((?:EPON|GPON)\d+/\d+:\d+)\s+"    # ONU-ID
                r"(\S+)\s+"                           # status
                r"((?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2})\s+",  # MAC
                line, re.IGNORECASE,
            )
            if not m:
                continue
            onu_id = m.group(1).upper()
            rest = line[m.end():]
            # Skip optional date/time tokens (YYYY/MM/DD HH:MM:SS or N/A)
            rest = re.sub(r"\d{4}/\d{2}/\d{2}\s+\d{2}:\d{2}:\d{2}", "", rest)
            rest = re.sub(r"\bN/A\b", "", rest, flags=re.IGNORECASE)
            nums = re.findall(r"\d+", rest)
            if not nums:
                continue
            rx_bytes = int(nums[0])
            # txOctets: 6th field (index 5) = after rxOctets, rxUcast, rxMcast, rxBcast, rxBadCrc32
            # On merged wide outputs columns shift — take the largest number as a fallback
            if len(nums) >= 6:
                tx_bytes = int(nums[5])
            elif len(nums) >= 2:
                # Fewer columns: use last non-zero value
                non_zero = [int(n) for n in nums[1:] if int(n) > 0]
                tx_bytes = non_zero[-1] if non_zero else 0
            else:
                tx_bytes = 0
            # Skip rows where both counters are 0 (OLT not tracking this ONU)
            if rx_bytes == 0 and tx_bytes == 0:
                continue
            result[onu_id] = {"rx_bytes": rx_bytes, "tx_bytes": tx_bytes}
        logger.debug(f"_parse_statistics: {len(result)} entries")
        return result

    def _parse_basic_info(self, output: str) -> Dict[str, Dict]:
        """
        Parse 'show onu basic-info all' output.
        Columns: ONU-ID | VendorID | Model | ID (MAC no colons) | hwVer | SwVer

        Example:
          EPON0/1:1   MONU      D401      14A72BE6CAC8  V2.8S  V6.0.4P1T8
        """
        result = {}
        for line in output.split("\n"):
            line = re.sub(r"[\x00-\x1f\x7f]+", " ", line).strip()
            m = re.match(
                r"((?:EPON|GPON)\d+/\d+:\d+)\s+"
                r"(\S+)\s+"
                r"(\S+)\s+"
                r"([0-9A-Fa-f]{12})\s+"
                r"(\S+)\s+"
                r"(\S+)",
                line, re.IGNORECASE,
            )
            if m:
                onu_id = m.group(1).upper()
                result[onu_id] = {
                    "vendor_id": m.group(2),
                    "model_id":  m.group(3),
                    "hw_version": m.group(5),
                    "sw_version": m.group(6),
                }
        logger.debug(f"_parse_basic_info: {len(result)} entries")
        return result

    def _parse_auth_info(self, output: str) -> Dict[str, Dict]:
        """
        Parse 'show onu auth-info all' output.
        Columns: ONU-ID | LLID | Status | MAC Address | RTT | Desc | Type | ...

        Example:
          EPON0/1:1   0   online   14:a7:2b:e6:ca:c8   1093   N/A   1GE ...

        Status field is intentionally permissive — matches any non-space word(s)
        before the MAC address to handle firmware variations (online, offline,
        auth_ok, normal, registering, deregistered, etc.)
        """
        result = {}
        for line in output.split("\n"):
            # Strip whitespace + control chars (OLT sends \x00\x08 backspaces near --More-- pages)
            line = re.sub(r"[\x00-\x1f\x7f]+", " ", line).strip()
            # ONU-ID (EPON#/#:# or GPON#/#:#), LLID, status, MAC address
            m = re.match(
                r"((?:EPON|GPON)\d+/\d+:\d+)\s+"           # ONU-ID
                r"(-?\d+)\s+"                               # LLID (int or -1 for offline)
                r"(\S+)\s+"                                 # status word (online/offline/etc.)
                r"((?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2})",# MAC address
                line, re.IGNORECASE
            )
            if m:
                onu_id = m.group(1).upper()
                status_word = m.group(3).lower()
                mac = m.group(4)
                # Classify from the explicit status column, not the whole line
                if "online" in status_word or status_word in ("auth", "normal", "registering"):
                    status = "online"
                else:
                    status = "offline"
                result[onu_id] = {
                    "mac_address": normalize_mac(mac),
                    "status":      status,
                    "dying_gasp":  False,
                }
        logger.debug(f"_parse_auth_info: {len(result)} entries")
        return result


# =========================================================================
# Module-level functions (proxy.py interface)
# =========================================================================

def get_onu_by_mac(olt_host: str, mac_address: str) -> Optional[Dict[str, Any]]:
    c = OLTTelnetClient(olt_host)
    try:
        return c.get_onu_by_mac(mac_address) if c.connect() else None
    finally:
        c.disconnect()


def get_all_onus(olt_host: str) -> List[Dict[str, Any]]:
    c = OLTTelnetClient(olt_host)
    try:
        return c.get_all_onus() if c.connect() else []
    finally:
        c.disconnect()


def reboot_onu(olt_host: str, pon_port: str, onu_index: int) -> bool:
    c = OLTTelnetClient(olt_host)
    try:
        return c.reboot_onu(pon_port, onu_index) if c.connect() else False
    finally:
        c.disconnect()


def get_onu_by_port_fast(olt_host: str, pon_port: str, onu_index: int) -> Optional[Dict[str, Any]]:
    """
    Fast targeted single-ONU fetch. Target: <10s for EPON, <15s for GPON.
    Uses per-port CLI context to scope commands to one port only.
    """
    c = OLTTelnetClient(olt_host)
    try:
        return c.get_onu_fast(pon_port, onu_index) if c.connect() else None
    finally:
        c.disconnect()


def get_onu_by_port(olt_host: str, pon_port: str, onu_index: int) -> Optional[Dict[str, Any]]:
    """
    Fetch a single ONU by its PON port + index.
    Faster than MAC search when pon_port/onu_index are already known (post-MAC-bridge).
    """
    c = OLTTelnetClient(olt_host)
    try:
        if not c.connect():
            return None
        target_id = f"{c._onu_id_prefix}{pon_port}:{onu_index}".upper()
        opm  = c._parse_opm_diag(c._run("show onu opm-diag all"))
        auth = c._parse_auth_info(c._run("show onu auth-info all"))
        if target_id not in opm and target_id not in auth:
            return None
        entry = {"olt_host": olt_host, "pon_port": pon_port, "onu_index": onu_index,
                 "polled_at": _utc_now_iso()}
        entry.update(opm.get(target_id, {}))
        entry.update(auth.get(target_id, {}))
        return entry
    finally:
        c.disconnect()
