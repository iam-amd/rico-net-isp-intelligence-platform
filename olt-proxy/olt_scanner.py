"""
OLT Scanner â€” One-time MAC Bridge Population Tool
Scans all ONUs on all OLTs and returns their MAC â†’ port â†’ index mapping.
This mapping is used to populate the Customer.olt_host, pon_port, onu_index fields.
"""

import logging
from typing import List, Dict, Any
import json

from config import OLT_HOSTS
import olt_client as olt  # or snmp_client, depending on OLT_CLIENT_MODE

logger = logging.getLogger(__name__)


def scan_all_onus() -> List[Dict[str, Any]]:
    """
    Scan all OLTs for all ONUs.
    Returns list of ONU records with MAC addresses.
    """
    all_onus = []

    for olt_host in OLT_HOSTS:
        logger.info(f"Scanning {olt_host}...")
        try:
            onus = olt.get_all_onus(olt_host)
            logger.info(f"Found {len(onus)} ONUs on {olt_host}")
            all_onus.extend(onus)
        except Exception as e:
            logger.error(f"Failed to scan {olt_host}: {e}")
            continue

    logger.info(f"Total ONUs found across all OLTs: {len(all_onus)}")
    return all_onus


def export_to_csv(onus: List[Dict[str, Any]], filename: str = "olt_onus_export.csv"):
    """Export ONU data to CSV for review."""
    import csv

    try:
        with open(filename, 'w', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=['mac_address', 'olt_host', 'pon_port', 'onu_index', 'status'])
            writer.writeheader()
            for onu in onus:
                writer.writerow({
                    'mac_address': onu.get('mac_address'),
                    'olt_host': onu.get('olt_host'),
                    'pon_port': onu.get('pon_port'),
                    'onu_index': onu.get('onu_index'),
                    'status': onu.get('status', 'unknown')
                })
        logger.info(f"Exported {len(onus)} ONUs to {filename}")
    except Exception as e:
        logger.error(f"Failed to export CSV: {e}")


def export_to_json(onus: List[Dict[str, Any]], filename: str = "olt_onus_export.json"):
    """Export ONU data to JSON."""
    try:
        with open(filename, 'w') as f:
            json.dump(onus, f, indent=2)
        logger.info(f"Exported {len(onus)} ONUs to {filename}")
    except Exception as e:
        logger.error(f"Failed to export JSON: {e}")


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)

    print("\n" + "=" * 80)
    print("OLT Scanner â€” MAC Bridge Population Tool")
    print("=" * 80 + "\n")

    onus = scan_all_onus()

    if onus:
        print(f"\nFound {len(onus)} ONUs total")
        print("\nSample ONUs (first 5):")
        for onu in onus[:5]:
            print(f"  {onu.get('mac_address'):17} â†’ {onu.get('olt_host')} {onu.get('pon_port'):10} ONU {onu.get('onu_index')}")

        # Export for review
        export_to_csv(onus)
        export_to_json(onus)

        print(f"\nExported to:")
        print(f"  - olt_onus_export.csv")
        print(f"  - olt_onus_export.json")
        print(f"\nNext step:")
        print(f"  1. Review the exported files")
        print(f"  2. Run backend/scripts/mac_bridge.py to populate Customer table")
    else:
        print("ERROR: No ONUs found! Check OLT connectivity and configuration.")
        print("Troubleshooting:")
        print("  1. Verify OLT IP in config.py (should be 10.10.10.100)")
        print("  2. Check Telnet connectivity: telnet 10.10.10.100")
        print("  3. Verify Telnet credentials in config.py")
