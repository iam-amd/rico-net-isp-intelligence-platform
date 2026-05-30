"""
Discover Netlink GPON OLT SNMP OIDs for ONU optical data.
Run on Pi: python3 snmp_discover.py 10.10.10.210
"""
import subprocess, sys, time

HOST = sys.argv[1] if len(sys.argv) > 1 else "10.10.10.210"

def get(oid):
    try:
        r = subprocess.run(
            ["snmpget", "-v2c", "-c", "public", "-t", "2", "-r", "0", HOST, oid],
            capture_output=True, text=True, timeout=4
        )
        o = r.stdout.strip()
        if o and "No Such" not in o and "Timeout" not in o and "Error" not in o and ":" in o:
            return o.split("=", 1)[-1].strip()
    except Exception:
        pass
    return None

def walk_first(oid, n=5, timeout=10):
    try:
        r = subprocess.run(
            ["snmpwalk", "-v2c", "-c", "public", "-t", "5", "-r", "0", HOST, oid],
            capture_output=True, text=True, timeout=timeout
        )
        lines = [l for l in r.stdout.split("\n") if l.strip()]
        return lines[:n]
    except Exception:
        return []

print(f"Netlink SNMP OID Discovery â€” {HOST}")
print("=" * 60)

# 1. Check sub-trees 37950.1.1.X for X in 1-20
print("\n[1] Mapping 37950.1.1.X sub-trees (first OID in each):")
for i in range(1, 21):
    rows = walk_first(f"1.3.6.1.4.1.37950.1.1.{i}", n=2, timeout=6)
    if rows:
        print(f"  37950.1.1.{i} : {rows[0][:90]}")

# 2. Try PON port/ONU specific patterns
print("\n[2] Scanning for PON/ONU data patterns:")
# Pattern: 37950.1.1.5.PORT.table.row.col.PORT.ONU_IDX
for port in range(1, 9):
    for col in range(1, 8):
        oid = f"1.3.6.1.4.1.37950.1.1.5.{port}.1.1.{col}.{port}.1"
        v = get(oid)
        if v:
            print(f"  HIT 37950.1.1.5.{port}.1.1.{col}.{port}.1 = {v[:60]}")

# 3. Check root-level sub-trees (37950.X for X > 1)
print("\n[3] Checking 37950.X for X in 2-10:")
for i in range(2, 11):
    rows = walk_first(f"1.3.6.1.4.1.37950.{i}", n=2, timeout=6)
    if rows:
        print(f"  37950.{i} : {rows[0][:90]}")

print("\nDone.")
