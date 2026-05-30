"""
OLT Engine bootstrap CLI.

Resolves customer DNA for all active customers on a target OLT by walking the
OLT's auth + FDB + optical SNMP tables, then matching each customer's Railwire
MAC. Prints a report. Writes NOTHING to the DB (Step 1 is read-only).

Usage:
  python run_engine_bootstrap.py --olt 100              # EPON .100
  python run_engine_bootstrap.py --olt 100 --verbose    # list every customer
  python run_engine_bootstrap.py --olt 100 --customer tn.bagrudeen.a03
"""
from __future__ import annotations

import argparse
import logging
import sys
import time
from typing import Dict, List, Optional

from sqlalchemy import text

from database import SessionLocal
from services.olt_engine import snmp_runner
from services.olt_engine.epon_100 import EponOLT100
from services.olt_engine.types import (
    BootstrapReport,
    CustomerDNARecord,
    Position,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("rico_net.bootstrap")


def _normalize_mac(mac: str | None) -> str | None:
    if not mac: return None
    cleaned = mac.upper().replace("-", ":").replace(".", ":")
    cleaned = cleaned.replace(" ", "")
    parts = cleaned.split(":")
    if len(parts) != 6: return None
    if not all(len(p) == 2 for p in parts): return None
    return ":".join(parts)


def _hex_distance(a: str, b: str) -> Optional[int]:
    """Compute |int(a)-int(b)| where a,b are 2-char hex strings. None on parse fail."""
    try: return abs(int(a, 16) - int(b, 16))
    except ValueError: return None


def _find_offset_match(
    railwire_mac: str,
    auth_macs: List[str],
    olt_host: str,
    auth_table: Dict[str, Position],
) -> Optional[tuple]:
    """
    Find ONU auth MAC on same OLT with same first 5 bytes and nearest last byte.
    Returns (auth_mac, offset, position) or None.
    """
    rw_parts = railwire_mac.upper().split(":")
    if len(rw_parts) != 6: return None
    prefix = ":".join(rw_parts[:5])
    rw_last = rw_parts[5]

    candidates = []
    for mac in auth_macs:
        pos = auth_table.get(mac)
        if pos is None or pos.olt_host != olt_host: continue
        if not mac.startswith(prefix + ":"): continue
        last = mac.split(":")[-1]
        dist = _hex_distance(rw_last, last)
        if dist is None: continue
        if dist > 16: continue  # constrain to ±16
        candidates.append((dist, mac, pos))

    if not candidates: return None
    candidates.sort()
    if len(candidates) > 1 and candidates[0][0] == candidates[1][0]:
        # ambiguous (two equally-near MACs) — refuse
        return None
    dist, mac, pos = candidates[0]
    int_offset = int(mac.split(":")[-1], 16) - int(rw_last, 16)
    return (mac, int_offset, pos)


def load_customers(db, olt_host: str, only_one: Optional[str] = None) -> list:
    """Customer rows whose stored olt_host (legacy or binding) hits this OLT."""
    sql = """
    SELECT
      c.username, c.first_name, c.last_name, c.phone, c.status,
      c.mac_address           AS railwire_mac,
      c.router_mac_address    AS router_mac,
      c.ont_serial_number     AS sticker_serial,
      c.ont_sticker_data,
      (
        SELECT b.olt_host FROM onu_bindings b
        WHERE b.customer_id = c.username AND b.is_active = TRUE
        ORDER BY b.verified_at DESC NULLS LAST LIMIT 1
      )                       AS binding_olt
    FROM customers c
    WHERE c.status='Active' AND c.mac_address IS NOT NULL
    """
    params = {}
    if only_one:
        sql += " AND c.username = :u"
        params["u"] = only_one
    rows = db.execute(text(sql), params).mappings().all()
    return [r for r in rows if (r["binding_olt"] == olt_host) or (r["binding_olt"] is None)]


def resolve_customer(
    row: dict,
    auth_table: Dict[str, Position],
    fdb_table: Dict[str, Position],
    optical_table: Dict[Position, "OpticalData"],
    olt_host: str,
) -> CustomerDNARecord:
    """Apply the matching rules in order: sticker → fdb → offset → none."""
    railwire_mac = _normalize_mac(row.get("railwire_mac"))

    # sticker MAC: from ont_sticker_data.macAddress (OCR sticker scan)
    sticker_mac = None
    sticker_data = row.get("ont_sticker_data") or {}
    if isinstance(sticker_data, dict):
        candidate = sticker_data.get("macAddress")
        if candidate:
            cleaned = candidate.upper().replace("-", "").replace(":", "").replace(".", "")
            if len(cleaned) == 12:
                sticker_mac = ":".join(cleaned[i:i+2] for i in range(0, 12, 2))

    record = CustomerDNARecord(
        username=row["username"],
        railwire_mac=railwire_mac,
        sticker_optical_mac=sticker_mac,
        sticker_serial=row.get("sticker_serial"),
        router_mac=_normalize_mac(row.get("router_mac")),
    )

    # Rule 1 — sticker scan wins if it matches an OLT auth MAC
    if sticker_mac and sticker_mac in auth_table:
        pos = auth_table[sticker_mac]
        if pos.olt_host == olt_host:
            record.position = pos
            record.optical_mac = sticker_mac
            record.binding_source = "sticker_scan"
            record.confidence = "verified"
            if railwire_mac:
                rw_last = int(railwire_mac.split(":")[-1], 16)
                op_last = int(sticker_mac.split(":")[-1], 16)
                record.railwire_to_optical_offset = op_last - rw_last
            record.notes.append("sticker MAC matched OLT auth table")
            return record

    if not railwire_mac:
        record.notes.append("no Railwire MAC on customer record")
        return record

    # Rule 2 — Railwire MAC IS the optical MAC (direct auth-table hit).
    # Common for Netlink combined ONU+router: the same MAC is registered to
    # both the WAN-side (Railwire scrapes it) AND used as the optical auth MAC.
    if railwire_mac in auth_table:
        pos = auth_table[railwire_mac]
        if pos.olt_host == olt_host:
            record.position = pos
            record.optical_mac = railwire_mac
            record.binding_source = "auth_direct"
            record.confidence = "verified"   # OLT itself confirms position
            record.railwire_to_optical_offset = 0
            record.notes.append("Railwire MAC IS the ONU optical MAC")
            return record

    # Rule 3 — Railwire MAC seen in FDB → position → reverse-lookup the auth MAC there
    if railwire_mac in fdb_table:
        pos = fdb_table[railwire_mac]
        if pos.olt_host == olt_host:
            record.position = pos
            auth_at_pos = next((m for m, p in auth_table.items() if p == pos), None)
            record.optical_mac = auth_at_pos
            record.binding_source = "fdb_match"
            record.confidence = "probable"
            if auth_at_pos:
                rw_last = int(railwire_mac.split(":")[-1], 16)
                op_last = int(auth_at_pos.split(":")[-1], 16)
                record.railwire_to_optical_offset = op_last - rw_last
            record.notes.append("FDB hit on Railwire MAC, learned via this ONU")
            return record

    # Rule 4 — closest same-prefix auth MAC on this OLT
    offset = _find_offset_match(railwire_mac, list(auth_table.keys()), olt_host, auth_table)
    if offset:
        mac, off, pos = offset
        record.position = pos
        record.optical_mac = mac
        record.binding_source = "offset_match"
        record.confidence = "probable" if abs(off) <= 4 else "guess"
        record.railwire_to_optical_offset = off
        record.notes.append(f"offset match (±{off}) — no FDB / sticker evidence")
        return record

    # Rule 4 — nothing
    record.binding_source = "no_olt_match"
    record.confidence = "guess"
    record.notes.append("no FDB / offset / sticker match on this OLT")
    return record


def print_report(report: BootstrapReport, verbose: bool):
    print()
    print("=" * 90)
    print(f"OLT ENGINE BOOTSTRAP REPORT — {report.olt_host}")
    print("=" * 90)
    print(f"  duration             : {report.duration_seconds:.1f}s")
    print(f"  customers (Active)   : {report.customers_total}")
    print(f"    with Railwire MAC  : {report.customers_with_railwire_mac}")
    print(f"  auth table entries   : {report.auth_table_entries}")
    print(f"  fdb table entries    : {report.fdb_table_entries}")
    print(f"  optical entries      : {report.optical_table_entries}")
    print()
    print(f"  RESOLUTION:")
    print(f"    sticker_scan       : {report.resolved_sticker_scan}     (truth — sticker matches OLT auth)")
    print(f"    auth_direct        : {report.resolved_auth_direct}     (Railwire MAC IS optical MAC)")
    print(f"    fdb_match          : {report.resolved_fdb_match}     (Railwire learned through ONU)")
    print(f"    offset_match       : {report.resolved_offset_match}     (off-by-N nearest neighbor)")
    print(f"    no_olt_match       : {report.resolved_no_olt_match}     (not in OLT — offline/wrong OLT/replaced)")
    matched = (report.resolved_sticker_scan + report.resolved_auth_direct
               + report.resolved_fdb_match  + report.resolved_offset_match)
    if report.customers_total:
        pct = 100.0 * matched / report.customers_total
        print(f"  COVERAGE             : {matched}/{report.customers_total} ({pct:.1f}%)")
    print()
    if verbose:
        print(f"{'username':<28}  {'railwire_mac':<19}  {'optical_mac':<19}  {'position':<28}  {'source':<14}  off  rx_dbm")
        for r in report.records:
            pos = f"{r.position.olt_host} {r.position.pon_port}/{r.position.onu_index}" if r.position else "(none)"
            opt = r.optical_mac or "—"
            off = str(r.railwire_to_optical_offset) if r.railwire_to_optical_offset is not None else ""
            rx  = f"{r.live.rx_power_dbm:.2f}" if r.live.rx_power_dbm is not None else ""
            print(f"  {r.username:<28}  {r.railwire_mac or '—':<19}  {opt:<19}  {pos:<28}  {r.binding_source:<14}  {off:>3}  {rx}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--olt", required=True, choices=["100", "200", "210"])
    ap.add_argument("--verbose", "-v", action="store_true")
    ap.add_argument("--customer", help="Test on one customer only")
    args = ap.parse_args()

    if args.olt == "100":
        adapter = EponOLT100()
    elif args.olt == "210":
        from services.olt_engine.gpon_210 import GponOLT210
        adapter = GponOLT210()
    elif args.olt == "200":
        from services.olt_engine.gpon_200 import GponOLT200
        adapter = GponOLT200()
    else:
        print(f"OLT .{args.olt} adapter not implemented yet.")
        sys.exit(2)

    t0 = time.time()
    log.info("Walking OLT %s auth table ...", adapter.olt_host)
    auth_table = adapter.walk_auth_table()
    log.info("  → %d auth entries", len(auth_table))

    log.info("Walking OLT %s FDB table ...", adapter.olt_host)
    fdb_table = adapter.walk_fdb_table()
    log.info("  → %d FDB entries", len(fdb_table))

    log.info("Walking OLT %s optical table ...", adapter.olt_host)
    optical_table = adapter.walk_optical_table()
    log.info("  → %d optical entries", len(optical_table))

    log.info("Resolving customers ...")
    db = SessionLocal()
    try:
        rows = load_customers(db, adapter.olt_host, only_one=args.customer)
    finally:
        db.close()
    log.info("  → %d customer rows to resolve", len(rows))

    report = BootstrapReport(
        olt_host=adapter.olt_host,
        customers_total=len(rows),
        customers_with_railwire_mac=sum(1 for r in rows if r["railwire_mac"]),
        auth_table_entries=len(auth_table),
        fdb_table_entries=len(fdb_table),
        optical_table_entries=len(optical_table),
    )

    for row in rows:
        rec = resolve_customer(dict(row), auth_table, fdb_table, optical_table, adapter.olt_host)
        if rec.position:
            rec.live = optical_table.get(rec.position) or rec.live
        report.records.append(rec)

        if rec.binding_source == "sticker_scan":  report.resolved_sticker_scan += 1
        elif rec.binding_source == "auth_direct": report.resolved_auth_direct += 1
        elif rec.binding_source == "fdb_match":   report.resolved_fdb_match += 1
        elif rec.binding_source == "offset_match":report.resolved_offset_match += 1
        else:                                     report.resolved_no_olt_match += 1

    report.duration_seconds = time.time() - t0
    snmp_runner.close()
    print_report(report, verbose=args.verbose or bool(args.customer))


if __name__ == "__main__":
    main()
