"""
web_client.py â€” HTTP-based OLT data collector
=============================================
Replaces Telnet scraping with direct HTTP POST requests to the OLT web portal.

Discovered API (2026-05-02):
  POST /action/onustatusinfo.html  â†’ ALL ONU status, deregister reason, RTT, distance, alive time
  POST /action/onuopmdiag.html     â†’ ALL ONU optical (Rx/Tx dBm, temperature, voltage, distance)

  POST body: select=255&port_refresh=Refresh&who={last_ip_octet}&SessionKey={rotating_key}
  select=255 = ALL ports at once (no per-port loop needed)

  Auth: CAPTCHA login â†’ session cookie + rotating SessionKey injected in every response HTML.
  CAPTCHA: 5 individual PNG images (/images/vc1.png .. vc5.png), one char each â€” solved by EasyOCR.

Portal ports (confirmed):
  EPON 10.10.10.100 â†’ port 1010
  GPON 10.10.10.200 â†’ port 1010
  GPON 10.10.10.210 â†’ port 443

Returns data in same format as olt_client.py so olt_poller.py needs no changes.
Extra fields added: distance_m, deregister_reason, alive_time_sec, rtt_ns, tx_bias_current_ma.
"""

import io
import logging
import os
import re
import time
from typing import Any, Dict, List, Optional, Tuple

import requests
import urllib3
from bs4 import BeautifulSoup
from PIL import Image

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

logger = logging.getLogger("olt_web_client")

# ---------------------------------------------------------------------------
# OLT web portal config
# ---------------------------------------------------------------------------

OLT_WEB_PORTS: Dict[str, int] = {
    "10.10.10.100": 1010,
    "10.10.10.200": 1010,
    "10.10.10.210": 443,
}

_DEFAULT_WEB_USER = os.getenv("OLT_WEB_USER") or os.getenv("OLT_TELNET_USER", "")
_DEFAULT_WEB_PASSWORD = os.getenv("OLT_WEB_PASSWORD") or os.getenv("OLT_TELNET_PASSWORD", "")


def _web_credential_for(host: str) -> Tuple[str, str]:
    suffix = host.split(".")[-1]
    user = os.getenv(f"OLT_WEB_USER_{suffix}", _DEFAULT_WEB_USER)
    password = os.getenv(f"OLT_WEB_PASSWORD_{suffix}", _DEFAULT_WEB_PASSWORD)
    return user, password


OLT_WEB_CREDENTIALS: Dict[str, Tuple[str, str]] = {
    host: _web_credential_for(host)
    for host in OLT_WEB_PORTS
}

# Session timeout â€” re-login if last request was older than this
SESSION_TTL_SEC = 180

# ---------------------------------------------------------------------------
# Tesseract CAPTCHA solver
# ---------------------------------------------------------------------------

_TESSERACT_AVAILABLE: Optional[bool] = None  # None = not yet checked

def _check_tesseract() -> bool:
    global _TESSERACT_AVAILABLE
    if _TESSERACT_AVAILABLE is not None:
        return _TESSERACT_AVAILABLE
    try:
        import pytesseract
        pytesseract.get_tesseract_version()
        _TESSERACT_AVAILABLE = True
    except Exception:
        _TESSERACT_AVAILABLE = False
        logger.warning("pytesseract/Tesseract not available â€” CAPTCHA solving disabled")
    return _TESSERACT_AVAILABLE


# ---------------------------------------------------------------------------
# HTML parsing helpers
# ---------------------------------------------------------------------------

_SESSION_KEY_RE = re.compile(r"SessionKey\.value\s*=\s*'([^']+)'")
_ALIVE_RE = re.compile(r"(\d+):(\d+):(\d+)")


def _extract_session_key(html: str) -> Optional[str]:
    m = _SESSION_KEY_RE.search(html)
    return m.group(1) if m else None


def _parse_alive_time(val: str) -> Optional[int]:
    """Convert HH:MM:SS â†’ seconds. Handles 'D HH:MM:SS' for multi-day uptime."""
    if not val or val.strip() in ("N/A", ""):
        return None
    # Some firmware shows "1 03:21:18" (1 day + time)
    days = 0
    parts = val.strip().split(" ")
    time_part = parts[-1]
    if len(parts) == 2:
        try:
            days = int(parts[0])
        except ValueError:
            pass
    m = _ALIVE_RE.match(time_part)
    if not m:
        return None
    h, mn, s = int(m.group(1)), int(m.group(2)), int(m.group(3))
    return days * 86400 + h * 3600 + mn * 60 + s


def _safe_float(val: str) -> Optional[float]:
    try:
        v = float(val.strip())
        return None if v == 0.0 else v
    except (ValueError, AttributeError):
        return None


def _safe_int(val: str) -> Optional[int]:
    try:
        return int(val.strip())
    except (ValueError, AttributeError):
        return None


def _parse_onu_id(onu_id: str) -> Tuple[Optional[str], Optional[int]]:
    """
    Parse ONU ID string â†’ (pon_port, onu_index).
    Handles EPON0/1:3 â†’ ("0/1", 3)
           GPON0/2:7 â†’ ("0/2", 7)
    """
    m = re.match(r"[EG]PON(\d+/\d+):(\d+)", onu_id, re.IGNORECASE)
    if m:
        return "0/" + m.group(1).split("/")[-1], int(m.group(2))
    return None, None


def _parse_status_table(html: str, olt_host: str) -> List[Dict[str, Any]]:
    """
    Parse onustatusinfo.html response into list of ONU dicts.

    Columns: ONU ID, Status, MAC Address, Description, Distance(m), RTT(TO),
             Last Register Time, Last Deregister Time, Last Deregister Reason,
             Alive Time, Upgrade
    """
    soup = BeautifulSoup(html, "html.parser")
    tables = soup.find_all("table", attrs={"border": "1"})
    if not tables:
        logger.warning("onustatusinfo: no data table found in response")
        return []

    rows = tables[0].find_all("tr")[1:]  # skip header row
    onus = []
    for row in rows:
        cells = [td.get_text(strip=True) for td in row.find_all("td")]
        if len(cells) < 9:
            continue
        onu_id_str = cells[0]
        status_str = cells[1].lower()
        mac_raw = cells[2]
        distance_str = cells[4]
        rtt_str = cells[5]
        last_reg_str = cells[6]
        last_dereg_str = cells[7]
        dereg_reason = cells[8].strip()
        alive_str = cells[9] if len(cells) > 9 else ""

        pon_port, onu_index = _parse_onu_id(onu_id_str)
        status = "online" if "online" in status_str else "offline"

        # Dying gasp: ONU is offline and last left due to Power Off signal
        dying_gasp = (status == "offline") and (dereg_reason.lower() == "power off")

        onus.append({
            "mac_address": mac_raw,
            "olt_host": olt_host,
            "status": status,
            "pon_port": pon_port,
            "onu_index": onu_index,
            "dying_gasp": dying_gasp,
            # Optical fields â€” filled by _merge_optical_into_status()
            "rx_power_dbm": None,
            "tx_power_dbm": None,
            "temperature_c": None,
            "voltage_mv": None,
            # Extra web-portal-only fields
            "distance_m": _safe_int(distance_str),
            "rtt_ns": _safe_int(rtt_str),
            "deregister_reason": dereg_reason if dereg_reason not in ("N/A", "") else None,
            "alive_time_sec": _parse_alive_time(alive_str),
            "last_register_at": last_reg_str if last_reg_str not in ("N/A", "") else None,
            "last_deregister_at": last_dereg_str if last_dereg_str not in ("N/A", "") else None,
            "_transport": "web_portal",
        })

    return onus


def _parse_optical_table(html: str) -> Dict[str, Dict[str, Any]]:
    """
    Parse onuopmdiag.html response â†’ dict keyed by mac_address.

    Columns: ONU ID, MAC Address, Description, Distance(m), Temperature(Â°C),
             Supply Voltage(V), TX Bias Current(mA), TX Power(dBm), RX Power(dBm)
    """
    soup = BeautifulSoup(html, "html.parser")
    tables = soup.find_all("table", attrs={"border": "1"})
    if not tables:
        logger.warning("onuopmdiag: no data table found in response")
        return {}

    optical: Dict[str, Dict[str, Any]] = {}
    rows = tables[0].find_all("tr")[1:]
    for row in rows:
        cells = [td.get_text(strip=True) for td in row.find_all("td")]
        if len(cells) < 9:
            continue
        mac = cells[1]
        temp_c = _safe_float(cells[4])
        voltage_v = _safe_float(cells[5])
        tx_bias_ma = _safe_float(cells[6])
        tx_dbm = _safe_float(cells[7])
        rx_dbm = _safe_float(cells[8])
        optical[mac] = {
            "temperature_c": temp_c,
            "voltage_mv": round(voltage_v * 1000, 1) if voltage_v else None,
            "tx_bias_current_ma": tx_bias_ma,
            "tx_power_dbm": tx_dbm,
            "rx_power_dbm": rx_dbm,
        }
    return optical


def _merge_optical(status_onus: List[Dict], optical_map: Dict[str, Dict]) -> None:
    """Fill optical fields into status ONU dicts in-place."""
    matched = 0
    for onu in status_onus:
        opt = optical_map.get(onu["mac_address"])
        if opt:
            onu["rx_power_dbm"] = opt["rx_power_dbm"]
            onu["tx_power_dbm"] = opt["tx_power_dbm"]
            onu["temperature_c"] = opt["temperature_c"]
            onu["voltage_mv"] = opt["voltage_mv"]
            onu["tx_bias_current_ma"] = opt.get("tx_bias_current_ma")
            matched += 1
    logger.info("optical merge: %d/%d matched", matched, len(status_onus))


# ---------------------------------------------------------------------------
# CAPTCHA solver
# ---------------------------------------------------------------------------

def _solve_captcha_ocr(session: requests.Session, base_url: str) -> str:
    """
    Download 5 CAPTCHA PNG images, join into one horizontal strip, run tesseract.
    Returns the 5-char string, falls back to '?????' on failure.
    """
    if not _check_tesseract():
        logger.warning("OCR unavailable â€” submitting empty CAPTCHA (may work on some firmware)")
        return ""

    try:
        import pytesseract
    except ImportError:
        return ""

    imgs = []
    rand = int(time.time() * 1000) % 99999
    for i in range(1, 6):
        try:
            r = session.get(f"{base_url}/images/vc{i}.png?rand={rand + i}",
                            timeout=5, verify=False)
            imgs.append(Image.open(io.BytesIO(r.content)).convert("L"))
        except Exception as e:
            logger.warning("CAPTCHA image %d fetch failed: %s", i, e)

    if not imgs:
        return ""

    # Join all images horizontally with 8px padding between each
    PAD = 8
    total_w = sum(img.width for img in imgs) + PAD * (len(imgs) + 1)
    max_h = max(img.height for img in imgs)
    strip = Image.new("L", (total_w, max_h + PAD * 2), 255)
    x = PAD
    for img in imgs:
        y_off = (max_h - img.height) // 2 + PAD
        strip.paste(img, (x, y_off))
        x += img.width + PAD

    # Upscale 4x for tesseract (works better on larger images)
    strip = strip.resize((strip.width * 4, strip.height * 4), Image.NEAREST)

    # Binarize: dark pixels â†’ black, light â†’ white
    strip = strip.point(lambda p: 0 if p < 160 else 255)

    config = (
        "--psm 7 "
        "-c tessedit_char_whitelist="
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    )
    text = pytesseract.image_to_string(strip, config=config).strip()
    # Remove any whitespace that tesseract inserts between characters
    text = "".join(text.split())
    logger.info("%s: CAPTCHA OCR result: %r (len=%d)", base_url, text, len(text))
    return text if text else ""


# ---------------------------------------------------------------------------
# OLT web client â€” one instance per OLT host
# ---------------------------------------------------------------------------

class OLTWebClient:
    """
    Manages a login session to one OLT web portal and fetches ONU data via HTTP POST.
    Thread-safe: each host gets its own instance and lock.
    """

    def __init__(self, host: str):
        self.host = host
        port = OLT_WEB_PORTS.get(host, 1010)
        self.base_url = f"https://{host}:{port}"
        self.username, self.password = OLT_WEB_CREDENTIALS.get(host, (_DEFAULT_WEB_USER, _DEFAULT_WEB_PASSWORD))
        self.who = host.split(".")[-1]  # last octet: "100", "200", "210"
        self.session = requests.Session()
        self.session.verify = False
        self.session.headers.update({"User-Agent": "Mozilla/5.0 Rico-Net-Poller/1.0"})
        self._session_key: Optional[str] = None
        self._last_request_at: float = 0.0
        self._logged_in = False

    def _is_session_alive(self) -> bool:
        return self._logged_in and (time.time() - self._last_request_at) < SESSION_TTL_SEC

    def _post(self, path: str, extra: Dict[str, str]) -> Optional[str]:
        """POST to the portal, returns HTML response text."""
        self._last_request_at = time.time()
        data: Dict[str, Any] = {
            "select": 255,
            "port_refresh": "Refresh",
            "searchMac": "",
            "searchDescription": "",
            "onuid": "0/",
            "who": self.who,
        }
        data.update(extra)
        if self._session_key:
            data["SessionKey"] = self._session_key

        try:
            r = self.session.post(
                f"{self.base_url}/action/{path}",
                data=data,
                timeout=60,
                verify=False,
            )
            r.raise_for_status()
            # Rotate session key from response
            new_key = _extract_session_key(r.text)
            if new_key:
                self._session_key = new_key
            return r.text
        except Exception as e:
            logger.error("%s POST %s failed: %s", self.host, path, e)
            self._logged_in = False
            return None

    def _detect_login_type(self, login_html: str) -> str:
        """
        Return 'main' if the form action is main.html (CAPTCHA enforced),
        or 'login' if the form action is login.html (CAPTCHA not enforced).
        """
        m = re.search(r'<form[^>]+action=["\']([^"\']+)["\']', login_html, re.I)
        if m and "main.html" in m.group(1):
            return "main"
        return "login"

    def login(self) -> bool:
        """Login to the web portal, solving CAPTCHA when required."""
        self._logged_in = False
        self._session_key = None
        self.session.cookies.clear()

        try:
            r_get = self.session.get(
                f"{self.base_url}/action/login.html",
                timeout=10, verify=False,
            )
            r_get.raise_for_status()
        except Exception as e:
            logger.error("%s: GET login page failed: %s", self.host, e)
            return False

        login_type = self._detect_login_type(r_get.text)
        logger.debug("%s: detected login_type=%s", self.host, login_type)

        if login_type == "main":
            # EPON .100 / GPON .210 firmware: CAPTCHA validated server-side
            captcha = _solve_captcha_ocr(self.session, self.base_url)
            if not captcha:
                logger.warning("%s: CAPTCHA empty â€” login will likely fail", self.host)
            login_data = {
                "user": self.username,
                "pass": self.password,
                "verification_code": captcha,
                "button": "Login",
                "who": "100",
            }
            submit_url = f"{self.base_url}/action/main.html"
        else:
            # GPON .200 firmware: CAPTCHA not validated, legacy field names
            sk = _extract_session_key(r_get.text) or ""
            captcha = ""
            login_data = {
                "username": self.username,
                "password": self.password,
                "captcha": captcha,
                "SessionKey": sk,
                "Submit": "Login",
            }
            submit_url = f"{self.base_url}/action/login.html"

        try:
            r = self.session.post(
                submit_url,
                data=login_data,
                timeout=10,
                verify=False,
                allow_redirects=True,
            )
            # Success: response is the authenticated main page (not a login redirect)
            # Failed: 738-byte page with setTimeout("...login.html",3000)
            is_redirect_to_login = (
                "setTimeout" in r.text
                and "login.html" in r.text
                and len(r.text) < 1200
            )
            if is_redirect_to_login:
                logger.warning("%s: login rejected (captcha=%r) â€” got login redirect",
                               self.host, captcha)
                return False

            # For login.html type, verify we can now access a protected page
            if login_type == "login":
                r_check = self.session.get(
                    f"{self.base_url}/action/main.html",
                    timeout=5, verify=False,
                )
                if "setTimeout" in r_check.text and "login.html" in r_check.text:
                    logger.warning("%s: login.html POST appeared OK but main.html still needs auth",
                                   self.host)
                    return False

            self._session_key = _extract_session_key(r.text)
            self._logged_in = True
            self._last_request_at = time.time()
            logger.info("%s: logged in (type=%s, captcha=%r, session_key=%s)",
                        self.host, login_type, captcha, self._session_key)
            return True
        except Exception as e:
            logger.error("%s: login POST failed: %s", self.host, e)
            return False

    def ensure_session(self) -> bool:
        """Login if session is stale."""
        if self._is_session_alive():
            return True
        logger.info("%s: session stale â€” re-logging in", self.host)
        for attempt in range(3):
            if self.login():
                return True
            logger.warning("%s: login attempt %d/3 failed", self.host, attempt + 1)
            time.sleep(1)
        return False

    def get_all_onus(self) -> List[Dict[str, Any]]:
        """
        Fetch all ONU data (status + optical) from this OLT via HTTP POST.
        Returns list of ONU dicts in same format as olt_client.py.
        """
        if not self.ensure_session():
            logger.error("%s: cannot get ONUs â€” login failed", self.host)
            return []

        # Fetch status table (online/offline + deregister reason + distance + alive time)
        logger.info("%s: fetching ONU status (all ports)", self.host)
        status_html = self._post("onustatusinfo.html", {})
        if not status_html:
            return []

        onus = _parse_status_table(status_html, self.host)
        logger.info("%s: got %d ONUs from status page", self.host, len(onus))

        # Fetch optical table (Rx/Tx dBm, temp, voltage)
        logger.info("%s: fetching OPM diagnostics (all ports)", self.host)
        optical_html = self._post("onuopmdiag.html", {})
        if optical_html:
            optical_map = _parse_optical_table(optical_html)
            _merge_optical(onus, optical_map)
            logger.info("%s: optical data fetched for %d ONUs", self.host, len(optical_map))
        else:
            logger.warning("%s: optical fetch failed â€” Rx/Tx will be None", self.host)

        return onus

    # -----------------------------------------------------------------------
    # Alarm log
    # -----------------------------------------------------------------------

    def get_alarm_log(self, count: int = 200) -> List[Dict[str, Any]]:
        """
        Fetch the rolling alarm/event log from alarminfo.html.
        Returns list of dicts:  {no, time_str, level, event, message, olt_host}
        count: max entries to request (portal default 200, max 200).
        """
        if not self.ensure_session():
            logger.error("%s: cannot fetch alarm log â€” login failed", self.host)
            return []
        html = self._post("alarminfo.html", {"couter": count, "alarmtype": 96})
        if not html:
            return []
        soup = BeautifulSoup(html, "html.parser")
        tables = soup.find_all("table", attrs={"border": "1"})
        if not tables:
            return []
        rows = tables[0].find_all("tr")[1:]  # skip header
        entries = []
        for row in rows:
            cells = [td.get_text(strip=True) for td in row.find_all("td")]
            if len(cells) < 4:
                continue
            # 4-col format: No, Time, Level, Message  (GPON .200 style)
            # 5-col format: No, Time, Level, Event, Message  (GPON .210 / EPON style)
            if len(cells) >= 5:
                no, time_str, level, event, message = cells[0], cells[1], cells[2], cells[3], cells[4]
            else:
                no, time_str, level, message = cells[0], cells[1], cells[2], cells[3]
                # Derive event from start of message
                event = message.split()[0] if message else ""
            entries.append({
                "no": int(no) if no.isdigit() else 0,
                "time_str": time_str,
                "level": level,
                "event": event,
                "message": message,
                "olt_host": self.host,
            })
        logger.info("%s: alarm log fetched %d entries", self.host, len(entries))
        return entries

    # -----------------------------------------------------------------------
    # PON port stats (bandwidth counters + optical transceiver health)
    # -----------------------------------------------------------------------

    def get_pon_stats(self) -> Dict[str, Any]:
        """
        Fetch poninfo.html â€” two tables:
          optical:  [{port, temp_c, voltage_v, bias_ma, tx_dbm}]
          traffic:  [{port, link, speed, rx_bytes, tx_bytes, rx_packets, tx_packets,
                      rx_unicast, rx_bcast, rx_mcast, tx_unicast, tx_bcast, tx_mcast, errors}]
        Returns {"optical": [...], "traffic": [...]}
        """
        if not self.ensure_session():
            return {"optical": [], "traffic": []}
        html = self._post("poninfo.html", {})
        if not html:
            return {"optical": [], "traffic": []}

        soup = BeautifulSoup(html, "html.parser")
        tables = soup.find_all("table", attrs={"border": "1"})

        optical = []
        traffic = []

        # Table 1 â€” optical transceiver health (always present)
        if len(tables) >= 1:
            for row in tables[0].find_all("tr"):
                cells = [td.get_text(strip=True) for td in row.find_all(["td", "th"])]
                # Skip header row (first cell is header text like "PON1" implies data)
                if not cells or not cells[0].startswith("PON"):
                    continue
                # Columns: Port, Temp, Voltage, Bias_mA, TX_dBm  [, Detail]
                if len(cells) >= 5:
                    optical.append({
                        "port": cells[0],
                        "temp_c": _safe_float(cells[1]),
                        "voltage_v": _safe_float(cells[2]),
                        "bias_ma": _safe_float(cells[3]),
                        "tx_dbm": _safe_float(cells[4]),
                    })

        # Table 2 â€” traffic counters (present on EPON .100; GPON may not have it)
        if len(tables) >= 2:
            rows = tables[1].find_all("tr")
            # Two-row header: skip rows until we hit a PON/GE row
            for row in rows:
                cells = [td.get_text(strip=True) for td in row.find_all(["td", "th"])]
                if not cells or not (cells[0].startswith("PON") or cells[0].startswith("GE")):
                    continue
                # Columns: Port, LinkStatus, Speed,
                #          RxBytes, RxPkts, RxUcast, RxBcast, RxMcast,
                #          TxBytes, TxPkts, TxUcast, TxBcast, TxMcast,
                #          Collisions, Errors
                if len(cells) >= 13:
                    traffic.append({
                        "port": cells[0],
                        "link": cells[1],
                        "speed": cells[2],
                        "rx_bytes": int(cells[3]) if cells[3].isdigit() else None,
                        "rx_packets": int(cells[4]) if cells[4].isdigit() else None,
                        "rx_unicast": int(cells[5]) if cells[5].isdigit() else None,
                        "rx_bcast": int(cells[6]) if cells[6].isdigit() else None,
                        "rx_mcast": int(cells[7]) if cells[7].isdigit() else None,
                        "tx_bytes": int(cells[8]) if cells[8].isdigit() else None,
                        "tx_packets": int(cells[9]) if cells[9].isdigit() else None,
                        "tx_unicast": int(cells[10]) if cells[10].isdigit() else None,
                        "tx_bcast": int(cells[11]) if cells[11].isdigit() else None,
                        "tx_mcast": int(cells[12]) if cells[12].isdigit() else None,
                        "errors": int(cells[14]) if len(cells) > 14 and cells[14].isdigit() else 0,
                    })

        logger.info("%s: pon_stats optical=%d traffic=%d",
                    self.host, len(optical), len(traffic))
        return {"optical": optical, "traffic": traffic}

    # -----------------------------------------------------------------------
    # OLT system info (health: CPU, memory, temperature, firmware)
    # -----------------------------------------------------------------------

    def get_system_info(self) -> Dict[str, Any]:
        """
        Fetch systeminfo.html.
        Returns: {firmware, hw_version, serial, mac, temp_c, cpu_pct, mem_pct,
                  system_time, running_time, device_model}
        """
        if not self.ensure_session():
            return {}
        html = self._post("systeminfo.html", {})
        if not html:
            return {}
        soup = BeautifulSoup(html, "html.parser")
        tables = soup.find_all("table", attrs={"border": "1"})
        info: Dict[str, Any] = {"olt_host": self.host}
        for tbl in tables:
            for row in tbl.find_all("tr"):
                cells = [td.get_text(strip=True) for td in row.find_all(["td", "th"])]
                # Each row is: Label, Value, Label, Value (4-cell key-value pairs)
                for i in range(0, len(cells) - 1, 2):
                    k = cells[i].strip().rstrip(":")
                    v = cells[i + 1].strip() if i + 1 < len(cells) else ""
                    lk = k.lower()
                    if "firmware" in lk or "software version" in lk:
                        info["firmware"] = v
                    elif "hardware" in lk:
                        info["hw_version"] = v
                    elif "serial" in lk:
                        info["serial"] = v
                    elif "mac address" in lk:
                        info["mac"] = v
                    elif "temperature" in lk:
                        info["temp_c"] = _safe_float(v.replace("Â°C", "").replace("C", "").strip())
                    elif "cpu usage" in lk:
                        info["cpu_pct"] = _safe_float(v.replace("%", "").strip())
                    elif "memory usage" in lk:
                        info["mem_pct"] = _safe_float(v.replace("%", "").strip())
                    elif "system time" in lk:
                        info["system_time"] = v
                    elif "running time" in lk:
                        info["running_time"] = v
                    elif "device model" in lk:
                        info["device_model"] = v
        logger.info("%s: system_info fetched: cpu=%s%% mem=%s%% temp=%sÂ°C",
                    self.host, info.get("cpu_pct"), info.get("mem_pct"), info.get("temp_c"))
        return info


# ---------------------------------------------------------------------------
# Module-level API (matches olt_client.py interface)
# ---------------------------------------------------------------------------

_clients: Dict[str, OLTWebClient] = {}


def _get_client(host: str) -> OLTWebClient:
    if host not in _clients:
        _clients[host] = OLTWebClient(host)
    return _clients[host]


def get_all_onus(host: str) -> List[Dict[str, Any]]:
    """Public API â€” same signature as olt_client.get_all_onus()."""
    return _get_client(host).get_all_onus()


def get_alarm_log(host: str, count: int = 200) -> List[Dict[str, Any]]:
    """Return the rolling alarm log for this OLT (up to `count` most recent entries)."""
    return _get_client(host).get_alarm_log(count)


def get_pon_stats(host: str) -> Dict[str, Any]:
    """Return PON port optical transceiver health + cumulative traffic counters."""
    return _get_client(host).get_pon_stats()


def get_system_info(host: str) -> Dict[str, Any]:
    """Return OLT system health: CPU, memory, temperature, firmware, uptime."""
    return _get_client(host).get_system_info()


def login(host: str) -> bool:
    """Force a fresh login to the given OLT."""
    return _get_client(host).login()


def health_check(host: str) -> Dict[str, Any]:
    """Verify the web portal is reachable and we can log in."""
    client = _get_client(host)
    reachable = False
    try:
        r = requests.get(
            f"{client.base_url}/action/login.html",
            timeout=5, verify=False,
        )
        reachable = r.status_code == 200
    except Exception:
        pass
    return {
        "host": host,
        "base_url": client.base_url,
        "reachable": reachable,
        "logged_in": client._logged_in,
        "session_key": client._session_key,
    }


# ---------------------------------------------------------------------------
# CLI test
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import json
    import sys
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

    host = sys.argv[1] if len(sys.argv) > 1 else "10.10.10.100"
    print(f"\n=== Web portal test for {host} ===")
    client = OLTWebClient(host)

    print("Logging in...")
    if not client.login():
        print("Login FAILED")
        sys.exit(1)
    print("Login OK")

    print("Fetching all ONU data...")
    onus = client.get_all_onus()
    print(f"Got {len(onus)} ONUs")

    if onus:
        online = sum(1 for o in onus if o["status"] == "online")
        offline = sum(1 for o in onus if o["status"] == "offline")
        power_off = sum(1 for o in onus if o.get("deregister_reason") == "Power Off")
        wire_down = sum(1 for o in onus if o.get("deregister_reason") == "Wire Down")
        has_rx = sum(1 for o in onus if o.get("rx_power_dbm") is not None)
        print(f"  online={online} offline={offline}")
        print(f"  last_offline_reason: Power Off={power_off} Wire Down={wire_down}")
        print(f"  optical coverage: {has_rx}/{len(onus)} ({has_rx*100//len(onus)}%)")
        print(f"\nFirst 3 ONUs:")
        for o in onus[:3]:
            print(json.dumps({k: v for k, v in o.items() if not k.startswith("_")}, indent=2))
