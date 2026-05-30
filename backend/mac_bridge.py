"""
MAC Bridge Scan â€” One-Time Script
===================================
Connects to OLT via Telnet, scans all ONUs across all PON ports,
matches each ONU MAC address to a customer in the database,
and writes back: olt_host, pon_port, onu_index.

Run ONCE after initial deployment. Re-run if customers are added
or if ONUs are moved to different ports.

Usage:
    cd backend
    python mac_bridge.py

Expected output:
    Scanning OLT 10.10.10.100 ...
    Found 303 ONUs on OLT
    Matched 241 customers to OLT ports
    Unmatched ONUs (not in customer DB): 62
    Customers with MAC but no ONU match: 588
"""

import sys
import os

# Add parent dir so we can import backend modules when run from backend/
sys.path.insert(0, os.path.dirname(__file__))

from database import SessionLocal
from models import Customer
from sqlalchemy import text

# Import olt_client from olt-proxy folder
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'olt-proxy'))
import olt_client

# â”€â”€â”€ CONFIG â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

OLT_HOSTS = ["10.10.10.100"]   # add more when you have more OLTs

# â”€â”€â”€ HELPERS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def normalize_mac(mac: str) -> str:
    """Lowercase, colon-delimited MAC. e.g. '8CC7C32FED87' â†’ '8c:c7:c3:2f:ed:87'"""
    mac = mac.strip().lower().replace("-", ":").replace(".", ":")
    # Remove colons and reformat
    clean = mac.replace(":", "")
    if len(clean) != 12:
        raise ValueError(f"Invalid MAC: {mac!r}")
    return ":".join(clean[i:i+2] for i in range(0, 12, 2))


# â”€â”€â”€ MAIN â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def run():
    db = SessionLocal()
    total_matched = 0
    total_onus = 0
    total_unmatched_onus = 0
    total_updated = 0

    try:
        for olt_host in OLT_HOSTS:
            print(f"\nScanning OLT {olt_host} ...")
            print("  (This takes ~30 seconds â€” fetching all ONUs via Telnet)")

            try:
                onus = olt_client.get_all_onus(olt_host)
            except Exception as e:
                print(f"  ERROR: Could not connect to OLT {olt_host}: {e}")
                continue

            total_onus += len(onus)
            print(f"  Found {len(onus)} ONUs on OLT")

            # Build MAC â†’ ONU lookup
            mac_to_onu = {}
            for onu in onus:
                raw_mac = onu.get("mac_address", "")
                if not raw_mac:
                    continue
                try:
                    mac = normalize_mac(raw_mac)
                    mac_to_onu[mac] = onu
                except ValueError:
                    continue

            print(f"  ONUs with valid MAC: {len(mac_to_onu)}")

            # Load all customers that have a MAC address
            customers = db.query(Customer).filter(
                Customer.mac_address.isnot(None)
            ).all()

            print(f"  Customers with MAC in DB: {len(customers)}")
            print(f"  Matching ...")

            matched = 0
            for customer in customers:
                try:
                    cust_mac = normalize_mac(customer.mac_address)
                except (ValueError, TypeError):
                    continue

                onu = mac_to_onu.get(cust_mac)
                if onu:
                    # Update customer with OLT location
                    customer.olt_host = olt_host
                    customer.pon_port = onu.get("pon_port")
                    customer.onu_index = onu.get("onu_index")
                    matched += 1

            db.commit()
            total_matched += matched
            total_updated += matched
            total_unmatched_onus += len(mac_to_onu) - matched

            print(f"  Matched and updated: {matched} customers")

        # Summary
        print("\n" + "=" * 60)
        print("MAC BRIDGE SCAN COMPLETE")
        print("=" * 60)
        print(f"  Total ONUs found on OLTs : {total_onus}")
        print(f"  Customers updated        : {total_updated}")
        print(f"  ONUs with no customer    : {total_unmatched_onus}")

        # Show coverage
        total_customers = db.execute(text("SELECT COUNT(*) FROM customers")).scalar()
        with_mac = db.execute(
            text("SELECT COUNT(*) FROM customers WHERE mac_address IS NOT NULL")
        ).scalar()
        with_olt = db.execute(
            text("SELECT COUNT(*) FROM customers WHERE olt_host IS NOT NULL")
        ).scalar()

        print(f"\n  DB Coverage:")
        print(f"    Total customers        : {total_customers}")
        print(f"    Have MAC (from scraper): {with_mac}")
        print(f"    Have OLT port mapping  : {with_olt}")
        print(f"    Coverage               : {with_olt}/{with_mac} = {with_olt*100//with_mac if with_mac else 0}%")

        if total_unmatched_onus > 0:
            print(f"\n  {total_unmatched_onus} ONUs on OLT have no matching customer.")
            print("  These may be: trial connections, staff accounts, or missing from Railwire scraper.")
        print("=" * 60)

    finally:
        db.close()


if __name__ == "__main__":
    run()
