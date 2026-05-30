"""Create or rotate a collector ingest credential.

Usage:
  python scripts/upsert_collector_credential.py office-pi-1 "long-random-token"

Then set on the Pi:
  COLLECTOR_ID=office-pi-1
  OLT_PROXY_TOKEN=long-random-token
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import SessionLocal
from services.collector_auth_service import upsert_collector_credential


def main() -> None:
    parser = argparse.ArgumentParser(description="Create or rotate a collector ingest token")
    parser.add_argument("collector_id", help="Stable collector ID, e.g. office-pi-1")
    parser.add_argument("token", help="Long random token stored only on the collector")
    parser.add_argument("--inactive", action="store_true", help="Create/rotate but mark inactive")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        credential = upsert_collector_credential(
            db,
            collector_id=args.collector_id,
            token=args.token,
            is_active=not args.inactive,
        )
        state = "active" if credential.is_active else "inactive"
        print(
            f"collector_id={credential.collector_id} status={state} "
            f"token_last_four={credential.token_last_four}"
        )
    finally:
        db.close()


if __name__ == "__main__":
    main()
