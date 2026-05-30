#!/usr/bin/env python3
"""
SNMP Audit â€” Rico Net
Discovers which SNMP OIDs expose ONU data on Netlink OLTs.
Cross-references live Telnet data to confirm OID semantics.

Run on Pi (/home/rico/olt-proxy/):
  python3 snmp_audit.py                    # full audit all 3 OLTs
  python3 snmp_audit.py 10.10.10.100      # single OLT
  python3 snmp_audit.py --quick            # connectivity check only (~5s)
  python3 snmp_audit.py --no-telnet        # walk only, skip Telnet cross-ref

Output:
  snmp_oid_profile.json    â€” OID map per OLT (load by snmp_client.py)
  snmp_walk_<IP>.txt       â€” raw walk dump for offline analysis
"""

import argparse
import json
import os
import re
import sys
import time
from typing import Any, Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Local imports
# ---------------------------------------------------------------------------
from snmp_walk_raw import walk as _raw_walk, _parse_snmp_msg, build_getbulk  # noqa: F401
from config import OLT_HOSTS, SNMP_COMMUNITY_READ, SNMP_PORT

try:
    from olt_client import get_all_onus as _telnet_get_all
    _TELNET_OK = True
except Exception:
    _TELNET_OK = False

import socket as _socket

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Enterprise OID roots to probe (Netlink has registered under multiple arcs)
ENTERPRISE_ROOTS = [
    "1.3.6.1.4.1.26149",   # Netlink/BDCOM (config.py default)
    "1.3.6.1.4.1.37950",   # Netlink OLT series (used in older probes)
    "1.3.6.1.4.1.17409",   # Realtek EPON stack (some Netlink OEM)
    "1.3.6.1.4.1.33897",   # Calix/Compass (used by some Netlink resellers)
]

STANDARD_ROOTS = [
    "1.3.6.1.2.1.1",       # system â€” sysDescr, sysObjectID
    "1.3.6.1.2.1.2.2",     # ifTable â€” interface names, MAC, oper status
    "1.3.6.1.2.1.10.7",    # dot3 â€” Ethernet stats
    "1.3.6.1.2.1.158",     # EPON MIB (IEEE 802.3ah / RFC 7630)
]

# Hard cap per subtree to avoid runaway walks on large tables
MAX_OIDS_PER_SUBTREE = 8000

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


def _pr(msg: str) -> None:
    print(msg, flush=True)


# ---------------------------------------------------------------------------
# SNMP helpers
# ---------------------------------------------------------------------------

def snmp_get_one(host: str, oid: str, community: str = "public",
                 port: int = SNMP_PORT, timeout: float = 5.0) -> Optional[Any]:
    """SNMP GET a single OID. Returns value or None on failure."""
    import socket
    try:
        pkt = build_getbulk(community, oid, max_reps=1)
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(timeout)
        sock.sendto(pkt, (host, port))
        data, _ = sock.recvfrom(65535)
        sock.close()
        varbinds, err = _parse_snmp_msg(data)
        if varbinds and err == 0:
            for o, t, v in varbinds:
                if o.startswith(oid.rstrip(".0")) and t not in ("endofmib", "nosuchobject", "nosuchinstance"):
                    return v
    except Exception:
        pass
    return None


def walk_subtree(host: str, root: str, community: str = "public",
                 port: int = SNMP_PORT, pkt_timeout: int = 8) -> List[Tuple]:
    """Walk one SNMP subtree. Returns list of (oid, type, value)."""
    try:
        t0 = time.time()
        results = _raw_walk(
            host, community=community, start_oid=root,
            port=port, timeout=pkt_timeout, max_reps=50
        )
        results = results[:MAX_OIDS_PER_SUBTREE]
        elapsed = time.time() - t0
        if results:
            _pr(f"    {root} â†’ {len(results):>5} OIDs  ({elapsed:.1f}s)")
        else:
            _pr(f"    {root} â†’ empty ({elapsed:.1f}s)")
        return results
    except Exception as exc:
        _pr(f"    {root} â†’ ERROR: {exc}")
        return []


# ---------------------------------------------------------------------------
# MAC helpers
# ---------------------------------------------------------------------------

def _mac_to_bytes(mac: str) -> Optional[bytes]:
    """Normalize MAC string â†’ 6 bytes. Returns None for GPON serial numbers."""
    if not mac or mac.upper().startswith("SN:"):
        return None
    cleaned = re.sub(r"[:\-\.\s]", "", mac).upper()
    if len(cleaned) != 12:
        return None
    try:
        return bytes.fromhex(cleaned)
    except ValueError:
        return None


def _bytes_to_mac(b: bytes) -> str:
    return ":".join(f"{x:02x}" for x in b)


def _parse_hex_value(v: Any) -> Optional[bytes]:
    """Try to interpret an SNMP value as 6 MAC bytes."""
    s = str(v).replace(":", "").replace("-", "").replace(" ", "").upper()
    if len(s) == 12 and all(c in "0123456789ABCDEF" for c in s):
        try:
            return bytes.fromhex(s)
        except ValueError:
            pass
    return None


def find_mac_in_walk(results: List[Tuple], mac_bytes: bytes,
                     oid_prefix: str = "") -> List[str]:
    """
    Return OIDs that either:
    (a) have a value matching the 6-byte MAC, or
    (b) have the MAC encoded as dotted-decimal in their OID suffix.
    """
    mac_dotted = ".".join(str(b) for b in mac_bytes)
    mac_hex_uc = mac_bytes.hex().upper()
    hits = []
    for oid, t, v in results:
        if oid_prefix and not oid.startswith(oid_prefix):
            continue
        v_str = str(v)
        # value match (hex octet string)
        parsed = _parse_hex_value(v_str)
        if parsed and parsed == mac_bytes:
            hits.append(oid)
            continue
        # OID suffix match (MAC-indexed table)
        if mac_dotted in oid:
            hits.append(oid)
    return hits


# ---------------------------------------------------------------------------
# OID pattern inference
# ---------------------------------------------------------------------------

def _oid_split_at_mac(oid: str, mac_bytes: bytes) -> Tuple[str, str]:
    """Return (prefix, suffix) split at the 6-byte dotted-decimal MAC."""
    mac_dotted = ".".join(str(b) for b in mac_bytes)
    idx = oid.find(mac_dotted)
    if idx >= 0:
        prefix = oid[:idx].rstrip(".")
        suffix = oid[idx + len(mac_dotted):]
        return prefix, suffix
    return oid, ""


def _nearby(results: List[Tuple], target_oid: str, window: int = 30) -> List[Tuple]:
    oids = [r[0] for r in results]
    try:
        pos = next(i for i, o in enumerate(oids) if o == target_oid)
        return results[max(0, pos - window): pos + window]
    except StopIteration:
        return []


def _find_int_value_nearby(results: List[Tuple], target_oid: str,
                           target_val: int, window: int = 30) -> Optional[str]:
    """Find an OID near target_oid whose integer value matches target_val."""
    for oid, t, v in _nearby(results, target_oid, window):
        if t == "int" and v == target_val:
            return oid
    return None


# ---------------------------------------------------------------------------
# Cross-reference: Telnet snapshot â†” SNMP walk
# ---------------------------------------------------------------------------

def cross_reference(all_walk: List[Tuple], samples: List[Dict]) -> Dict:
    """
    For each Telnet ONU sample (mac + rx_power + status):
    1. Find the MAC in the SNMP walk â†’ extract global ONU index N
    2. Search the ENTIRE walk for any OID ending in N whose value matches Rx power
       (optical OIDs are often in a different subtable â€” proximity search misses them)
    3. Return dict keyed by discovered MAC column prefix.
    """
    # Build suffix index: last-N OID parts â†’ [(oid, type, value), ...]
    # Used to find all OIDs sharing the same terminal index as the MAC OID.
    suffix_1: Dict[str, List[Tuple]] = {}  # e.g. "16" â†’ [...]
    suffix_2: Dict[str, List[Tuple]] = {}  # e.g. "1.34" â†’ [...]
    for entry in all_walk:
        oid, t, v = entry
        parts = oid.split(".")
        s1 = parts[-1]
        s2 = ".".join(parts[-2:])
        suffix_1.setdefault(s1, []).append(entry)
        suffix_2.setdefault(s2, []).append(entry)

    discoveries: Dict[str, Dict] = {}

    for sample in samples:
        mac_bytes = _mac_to_bytes(sample.get("mac_address", ""))
        if not mac_bytes:
            continue

        matches = find_mac_in_walk(all_walk, mac_bytes)
        if not matches:
            continue

        rx = sample.get("rx_power_dbm")
        status_str = (sample.get("status") or "").lower()
        status_int = 1 if status_str in ("online", "working") else 0

        for mac_oid in matches:
            # Determine index type and extract the ONU index
            mac_dotted = ".".join(str(b) for b in mac_bytes)
            if mac_dotted in mac_oid:
                index_type = "mac-indexed"
                mac_col_prefix, _ = _oid_split_at_mac(mac_oid, mac_bytes)
                global_idx = None
            else:
                index_type = "numeric"
                parts = mac_oid.split(".")
                global_idx = parts[-1]      # single-level index N
                global_idx_2 = ".".join(parts[-2:])  # two-level index P.N
                mac_col_prefix = ".".join(parts[:-1])  # strip index

            # â”€â”€ Search ENTIRE walk for Rx power OID â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            rx_oid: Optional[str] = None
            rx_mult_found: Optional[int] = None
            if rx is not None and index_type == "numeric" and global_idx:
                candidates = suffix_1.get(global_idx, []) + suffix_2.get(global_idx_2, [])
                for coid, ct, cv in candidates:
                    if coid == mac_oid or ct != "int":
                        continue
                    for mult in (10, 100, 1000):
                        if int(round(rx * mult)) == cv:
                            rx_oid = coid
                            rx_mult_found = mult
                            break
                    if rx_oid:
                        break

            # â”€â”€ Search ENTIRE walk for status OID â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            status_oid: Optional[str] = None
            if index_type == "numeric" and global_idx:
                for coid, ct, cv in suffix_1.get(global_idx, []):
                    if coid == mac_oid or coid == rx_oid:
                        continue
                    if ct == "int" and cv == status_int:
                        status_oid = coid
                        break

            # â”€â”€ Derive column prefixes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            def _col_prefix(oid_ex: Optional[str]) -> Optional[str]:
                if not oid_ex:
                    return None
                return ".".join(oid_ex.split(".")[:-1])

            rx_col = _col_prefix(rx_oid)
            st_col = _col_prefix(status_oid)

            key = mac_col_prefix or mac_oid[:40]
            if key not in discoveries:
                discoveries[key] = {
                    "mac_oid_example": mac_oid,
                    "mac_oid_base":    mac_col_prefix,
                    "mac_col_prefix":  mac_col_prefix,
                    "status_oid_example":  status_oid,
                    "status_col_prefix":   st_col,
                    "rx_power_oid_example": rx_oid,
                    "rx_col_prefix":       rx_col,
                    "rx_multiplier":       rx_mult_found,
                    "index_type":          index_type,
                    "index_depth":         1,
                    "verified_mac":        _bytes_to_mac(mac_bytes),
                    "verified_rx":         rx,
                }
            elif rx_oid and not discoveries[key].get("rx_power_oid_example"):
                discoveries[key]["rx_power_oid_example"] = rx_oid
                discoveries[key]["rx_col_prefix"] = rx_col
                discoveries[key]["rx_multiplier"] = rx_mult_found

    return discoveries


# ---------------------------------------------------------------------------
# Interface table analysis (ONU names â†’ port/index mapping)
# ---------------------------------------------------------------------------

def analyze_iftable(results: List[Tuple]) -> Dict:
    """
    Parse ifDescr values looking for ONU interface names like:
    'EPON01ONU3', 'GPON0/1:5', 'epon-0/1:3', etc.
    Build a map: if_index â†’ {onu_name, port, onu_idx}
    """
    onu_interfaces: Dict[str, Dict] = {}

    # Collect ifDescr (1.3.6.1.2.1.2.2.1.2) and ifPhysAddress (1.3.6.1.2.1.2.2.1.6)
    descr_prefix = "1.3.6.1.2.1.2.2.1.2."
    mac_prefix   = "1.3.6.1.2.1.2.2.1.6."
    status_prefix = "1.3.6.1.2.1.2.2.1.8."

    descr_map: Dict[str, str] = {}
    mac_map:   Dict[str, str] = {}
    status_map: Dict[str, int] = {}

    for oid, t, v in results:
        if oid.startswith(descr_prefix):
            idx = oid[len(descr_prefix):]
            descr_map[idx] = str(v)
        elif oid.startswith(mac_prefix):
            idx = oid[len(mac_prefix):]
            parsed = _parse_hex_value(str(v))
            if parsed and len(parsed) == 6:
                mac_map[idx] = _bytes_to_mac(parsed)
        elif oid.startswith(status_prefix):
            idx = oid[len(status_prefix):]
            if t == "int":
                status_map[idx] = int(v)

    # Match ONU-like interface names
    onu_pat = re.compile(
        r"(epon|gpon)[_\-/]?\d+[_\-/]?(\d+)[_:\-]?(\d+)|"  # EPON01ONU3 / GPON0/1:3
        r"onu[\-_]?(\d+)[_\./:](\d+)",
        re.IGNORECASE,
    )

    for idx, descr in descr_map.items():
        m = onu_pat.search(descr)
        if m:
            entry = {
                "if_index": idx,
                "if_name": descr,
                "mac": mac_map.get(idx),
                "status": status_map.get(idx),
            }
            onu_interfaces[idx] = entry

    return onu_interfaces


# ---------------------------------------------------------------------------
# Per-OLT audit
# ---------------------------------------------------------------------------

def audit_one(host: str, quick: bool = False, no_telnet: bool = False,
              community: str = SNMP_COMMUNITY_READ,
              port: int = SNMP_PORT) -> Dict:
    """Full SNMP audit for one OLT. Returns profile dict."""
    _pr(f"\n{'='*62}")
    _pr(f"  Auditing: {host}  community={community}  port={port}")
    _pr(f"{'='*62}")

    profile: Dict[str, Any] = {
        "host": host,
        "snmp_reachable": False,
        "sys_descr": None,
        "sys_object_id": None,
        "enterprise_oids_found": [],
        "oid_counts": {},
        "onu_interfaces": {},
        "discoveries": {},
        "verified": False,
        "notes": "",
        "audited_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }

    # â”€â”€ Phase 1: SNMP connectivity ping â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    # Use GetBulk from the PARENT OID (not the leaf .0) so the first returned
    # OID IS the leaf itself â€” prefix check then passes correctly.
    _pr("\n[1/4] SNMP connectivity ping...")
    descr = snmp_get_one(host, "1.3.6.1.2.1.1.1", community, port, timeout=6.0)
    if descr is None:
        profile["notes"] = "SNMP unreachable (timeout) â€” check OLT SNMP permit config"
        _pr("  FAIL â€” timeout. SNMP may still be blocked or community string wrong.")
        return profile

    profile["snmp_reachable"] = True
    profile["sys_descr"] = str(descr)[:200]
    _pr(f"  OK â€” {str(descr)[:100]}")

    obj_id = snmp_get_one(host, "1.3.6.1.2.1.1.2", community, port, timeout=5.0)
    if obj_id:
        profile["sys_object_id"] = str(obj_id)
        _pr(f"  sysObjectID: {obj_id}")

    if quick:
        profile["notes"] = "Quick mode â€” connectivity confirmed"
        return profile

    # â”€â”€ Phase 2: Standard MIB walks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    _pr("\n[2/4] Standard MIB walks...")
    all_walk: List[Tuple] = []
    for root in STANDARD_ROOTS:
        results = walk_subtree(host, root, community, port)
        profile["oid_counts"][root] = len(results)
        all_walk.extend(results)

    # Parse ifTable for ONU interface names
    iftable = [r for r in all_walk if r[0].startswith("1.3.6.1.2.1.2.2")]
    if iftable:
        profile["onu_interfaces"] = analyze_iftable(iftable)
        onu_if_count = len(profile["onu_interfaces"])
        _pr(f"  ifTable: {len(iftable)} entries, {onu_if_count} ONU interfaces detected")

    # â”€â”€ Phase 3: Enterprise MIB walks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    _pr("\n[3/4] Enterprise MIB walks...")
    for ent_root in ENTERPRISE_ROOTS:
        results = walk_subtree(host, ent_root, community, port)
        profile["oid_counts"][ent_root] = len(results)
        if results:
            profile["enterprise_oids_found"].append(ent_root)
            all_walk.extend(results)
            # Show top-level sub-trees found
            tops = sorted({".".join(r[0].split(".")[:len(ent_root.split(".")) + 2]) for r in results})
            for t in tops[:8]:
                _pr(f"    found subtree: {t}")

    total_oids = len(all_walk)
    _pr(f"\n  Total OIDs collected: {total_oids}")

    # Save raw walk file
    walk_file = os.path.join(_SCRIPT_DIR, f"snmp_walk_{host.replace('.', '_')}.txt")
    try:
        with open(walk_file, "w") as fh:
            for oid, t, v in all_walk:
                fh.write(f"{oid} [{t}] = {v}\n")
        _pr(f"  Raw walk saved â†’ {walk_file}")
    except Exception as exc:
        _pr(f"  Could not save walk file: {exc}")

    if not all_walk:
        profile["notes"] = "SNMP reachable but all MIB trees are empty"
        return profile

    # â”€â”€ Phase 4: Telnet cross-reference â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if no_telnet or not _TELNET_OK:
        _pr("\n[4/4] Skipping Telnet cross-reference (--no-telnet or not available)")
        profile["notes"] = (
            f"Walk complete â€” {total_oids} OIDs found. "
            "Re-run without --no-telnet on Pi for cross-reference."
        )
        _mark_candidate_discoveries(profile, all_walk)
        return profile

    _pr("\n[4/4] Telnet cross-reference (getting live ONU data)...")
    _pr(f"  Connecting to OLT {host} via Telnet (may take 60-400s)...")
    try:
        t0 = time.time()
        telnet_onus = _telnet_get_all(host)
        elapsed = time.time() - t0
        _pr(f"  Telnet returned {len(telnet_onus)} ONUs in {elapsed:.0f}s")
    except Exception as exc:
        _pr(f"  Telnet failed: {exc}")
        profile["notes"] = f"Walk complete but Telnet cross-ref failed: {exc}"
        _mark_candidate_discoveries(profile, all_walk)
        return profile

    # Use up to 8 online ONUs that have known Rx power for cross-reference
    candidates = [
        o for o in telnet_onus
        if o.get("mac_address")
        and not str(o.get("mac_address", "")).upper().startswith("SN:")
        and o.get("rx_power_dbm") is not None
        and o.get("status", "").lower() in ("online", "working")
    ][:8]

    _pr(f"  Using {len(candidates)} ONUs for cross-reference")

    if candidates:
        disc = cross_reference(all_walk, candidates)
        profile["discoveries"] = disc
        profile["verified"] = len(disc) > 0
        _pr(f"  Cross-reference: {len(disc)} OID pattern(s) confirmed")
        for key, d in disc.items():
            _pr(f"    MAC OID base  : {d.get('mac_oid_base')}")
            _pr(f"    index_type    : {d.get('index_type')}")
            _pr(f"    Rx power OID  : {d.get('rx_power_oid_example')}")
            _pr(f"    status OID    : {d.get('status_oid_example')}")
    else:
        _pr("  No online ONUs with known Rx power â€” cannot cross-reference")
        profile["notes"] = "Telnet returned ONUs but none with Rx power data (GPON?)"
        _mark_candidate_discoveries(profile, all_walk)

    return profile


def _mark_candidate_discoveries(profile: Dict, all_walk: List[Tuple]) -> None:
    """
    When Telnet cross-ref is not possible, try to infer ONU table structure
    from ifTable ONU interfaces that have MAC addresses.
    """
    onu_ifs = profile.get("onu_interfaces", {})
    mac_candidates = {d["mac"]: d for d in onu_ifs.values() if d.get("mac")}

    if not mac_candidates:
        return

    # Try to find these known-interface MACs in the enterprise walk
    enterprise_results = [
        r for r in all_walk
        if any(r[0].startswith(root) for root in profile.get("enterprise_oids_found", []))
    ]
    if not enterprise_results:
        return

    for mac_str, if_info in list(mac_candidates.items())[:3]:
        mac_bytes = _mac_to_bytes(mac_str)
        if not mac_bytes:
            continue
        matches = find_mac_in_walk(enterprise_results, mac_bytes)
        for oid in matches:
            prefix, _ = _oid_split_at_mac(oid, mac_bytes)
            key = f"candidate_{prefix[:30]}"
            if key not in profile["discoveries"]:
                profile["discoveries"][key] = {
                    "mac_oid_example": oid,
                    "mac_oid_base": prefix,
                    "index_type": "mac-indexed" if ".".join(str(b) for b in mac_bytes) in oid else "numeric",
                    "rx_power_oid_example": None,
                    "status_oid_example": None,
                    "verified_mac": mac_str,
                    "candidate_only": True,
                    "notes": "ifTable MAC match â€” not Rx-confirmed",
                }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Rico Net SNMP OLT Audit â€” discovers OIDs for snmp_client.py"
    )
    parser.add_argument(
        "hosts", nargs="*",
        help="OLT IPs to audit (default: all from config.py)"
    )
    parser.add_argument(
        "--quick", action="store_true",
        help="Connectivity check only â€” no walk, no Telnet"
    )
    parser.add_argument(
        "--no-telnet", action="store_true",
        help="Walk SNMP tree but skip Telnet cross-reference"
    )
    parser.add_argument(
        "--community", default=SNMP_COMMUNITY_READ,
        help=f"SNMP community (default: {SNMP_COMMUNITY_READ})"
    )
    parser.add_argument(
        "--port", type=int, default=SNMP_PORT,
        help=f"SNMP UDP port (default: {SNMP_PORT})"
    )
    parser.add_argument(
        "--output", default=os.path.join(_SCRIPT_DIR, "snmp_oid_profile.json"),
        help="Output JSON file path"
    )
    args = parser.parse_args()

    hosts = args.hosts or OLT_HOSTS
    mode = "QUICK" if args.quick else ("NO-TELNET" if args.no_telnet else "FULL")
    _pr(f"\nRico Net SNMP Audit â€” {mode} mode")
    _pr(f"OLTs    : {', '.join(hosts)}")
    _pr(f"Comm    : {args.community}   Port: {args.port}")
    _pr(f"Output  : {args.output}")

    # Load existing profile to merge (don't wipe already-verified hosts)
    existing: Dict = {}
    try:
        with open(args.output) as fh:
            existing = json.load(fh)
    except FileNotFoundError:
        pass

    profiles: Dict = dict(existing)

    for host in hosts:
        prof = audit_one(
            host,
            quick=args.quick,
            no_telnet=args.no_telnet,
            community=args.community,
            port=args.port,
        )
        profiles[host] = prof

    with open(args.output, "w") as fh:
        json.dump(profiles, fh, indent=2)

    _pr(f"\n{'='*62}")
    _pr("SUMMARY")
    _pr(f"{'='*62}")
    for host in hosts:
        p = profiles[host]
        reach   = "SNMP OK" if p.get("snmp_reachable") else "BLOCKED"
        oids    = sum(p.get("oid_counts", {}).values())
        disc    = len(p.get("discoveries", {}))
        verified = "VERIFIED âœ“" if p.get("verified") else "unverified"
        ent     = ", ".join(p.get("enterprise_oids_found", [])) or "none"
        _pr(f"  {host}  [{reach}]  OIDs={oids}  disc={disc}  [{verified}]")
        if ent != "none":
            _pr(f"    Enterprise MIBs with data: {ent}")
        if p.get("notes"):
            _pr(f"    Note: {p['notes']}")

    _pr(f"\nProfile written â†’ {args.output}")
    _pr("Next step: review snmp_oid_profile.json, then restart olt-poller")
    _pr("           (snmp_client.py reads this file automatically)")


if __name__ == "__main__":
    main()
