"""Debug: show raw OLT output for auth-info and opm-diag parsing."""
import logging, sys, os

# Set up debug logging
logging.basicConfig(level=logging.DEBUG, format="%(levelname)s %(name)s: %(message)s",
                    handlers=[logging.StreamHandler(sys.stdout)])

# Patch _parse_auth_info and _parse_opm_diag to print raw outputs
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

import olt_client as oc

# Monkey-patch get_all_onus to print raw command output before parsing
_orig_get = oc.OLTTelnetClient.get_all_onus
def _patched_get(self):
    raw_opm = self._run("show onu opm-diag all")
    raw_auth = self._run("show onu auth-info all")

    print("\n========== RAW OPM-DIAG ==========")
    for line in raw_opm.split("\n"):
        if line.strip():
            print(repr(line))

    print("\n========== RAW AUTH-INFO ==========")
    for line in raw_auth.split("\n"):
        if line.strip():
            print(repr(line))

    opm  = self._parse_opm_diag(raw_opm)
    auth = self._parse_auth_info(raw_auth)
    print(f"\nParsed OPM entries: {len(opm)}")
    print(f"Parsed AUTH entries: {len(auth)}")

    import re, time
    onus = []
    all_ids = set(opm.keys()) | set(auth.keys())
    for onu_id in all_ids:
        entry = {"olt_host": self.olt_host, "polled_at": time.strftime("%Y-%m-%dT%H:%M:%SZ")}
        entry.update(opm.get(onu_id, {}))
        entry.update(auth.get(onu_id, {}))
        m = re.match(r"EPON(\d+/\d+):(\d+)", onu_id, re.IGNORECASE)
        if m:
            entry["pon_port"] = m.group(1)
            entry["onu_index"] = int(m.group(2))
        onus.append(entry)
    return onus

oc.OLTTelnetClient.get_all_onus = _patched_get

from config import OLT_HOSTS
host = OLT_HOSTS[0]
print(f"Connecting to {host} ...")
onus = oc.get_all_onus(host)
with_mac = [o for o in onus if o.get("mac_address")]
print(f"\nTotal ONUs: {len(onus)}  With MAC: {len(with_mac)}  Without MAC: {len(onus)-len(with_mac)}")
if with_mac:
    print("Sample with MAC:", with_mac[0])
