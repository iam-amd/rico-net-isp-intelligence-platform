"""
Rico Net â€” Offset Discovery Script
====================================
Brute-forces all 256 possible last-byte offsets to find which ones
produce ONUâ†”Customer MAC matches without conflicts.

Run from backend/ directory:
    python scripts/discover_offsets.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import psycopg2
from collections import defaultdict

DB_URL = "postgresql://postgres:postgres@localhost/rico_net_demo"

def main():
    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()

    # Load all EPON ONU MACs
    cur.execute("""
        SELECT mac_address FROM onu_latest
        WHERE olt_host = '10.10.10.100'
        AND mac_address IS NOT NULL
        AND mac_address NOT LIKE 'SN:%'
        AND mac_address NOT LIKE 'GPON%'
    """)
    onu_macs = [r[0].upper() for r in cur.fetchall()]
    print(f"EPON ONUs: {len(onu_macs)}")

    # Load all customer MACs
    cur.execute("SELECT id, mac_address FROM customers WHERE mac_address IS NOT NULL")
    customer_rows = cur.fetchall()
    customer_macs = {r[1].upper(): r[0] for r in customer_rows}
    print(f"Customers with MAC: {len(customer_macs)}")

    # For each offset, count matches and conflicts
    results = []
    for offset in range(256):
        matches = {}   # onu_mac -> customer_id
        conflicts = 0

        for onu_mac in onu_macs:
            parts = onu_mac.split(":")
            if len(parts) != 6:
                continue
            last_byte = (int(parts[5], 16) + offset) % 256
            candidate = ":".join(parts[:5] + [f"{last_byte:02X}"])

            # Check both upper and lower case
            cid = customer_macs.get(candidate) or customer_macs.get(candidate.lower())
            if cid:
                if onu_mac in matches:
                    conflicts += 1  # same ONU matches 2 customers
                else:
                    matches[onu_mac] = cid

        # Check reverse conflicts (2 ONUs mapping to same customer)
        customer_hit_count = defaultdict(int)
        for cid in matches.values():
            customer_hit_count[cid] += 1
        reverse_conflicts = sum(1 for c in customer_hit_count.values() if c > 1)

        total_conflicts = conflicts + reverse_conflicts
        results.append((offset, len(matches), total_conflicts))

    # Sort by matches (desc), conflicts (asc)
    results.sort(key=lambda x: (-x[1], x[2]))

    print("\n=== TOP 20 OFFSETS (by match count, zero conflicts only) ===")
    print(f"{'Offset':>8}  {'Matches':>8}  {'Conflicts':>10}  {'Note'}")
    print("-" * 55)
    shown = 0
    for offset, matches, conflicts in results:
        if conflicts == 0 and matches > 0:
            note = ""
            if offset in (9, 5, 1):
                note = "  [KNOWN]"
            print(f"{offset:>8}  {matches:>8}  {conflicts:>10}  {note}")
            shown += 1
            if shown >= 20:
                break

    print("\n=== ALL OFFSETS WITH 5+ MATCHES (including conflicts) ===")
    print(f"{'Offset':>8}  {'Matches':>8}  {'Conflicts':>10}")
    print("-" * 35)
    for offset, matches, conflicts in results:
        if matches >= 5:
            flag = " *** NEW ***" if offset not in (9, 5, 1) and conflicts == 0 else ""
            print(f"{offset:>8}  {matches:>8}  {conflicts:>10}{flag}")

    # Known offsets summary
    print("\n=== KNOWN OFFSETS SUMMARY ===")
    for offset in [9, 5, 1, 0]:
        row = next((r for r in results if r[0] == offset), None)
        if row:
            print(f"  Offset +{offset}: {row[1]} matches, {row[2]} conflicts")

    conn.close()

if __name__ == "__main__":
    main()
