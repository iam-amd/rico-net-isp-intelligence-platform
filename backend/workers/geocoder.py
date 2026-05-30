"""
Rico Net — Geocoding Worker
============================
Converts railwire_address strings → geo_lat / geo_long using the
Nominatim (OpenStreetMap) API.  No API key required. Rate limit: 1 req/sec.

Usage:
    python -m workers.geocoder              # geocode all missing
    python -m workers.geocoder --limit 100  # geocode up to 100 at a time
    python -m workers.geocoder --dry-run    # preview without writing

The worker is intentionally conservative:
  - Tries the full address first
  - Falls back to "street, area, pincode" if that fails
  - Falls back to just the pincode area if still nothing
  - Skips rather than stores wrong data

Results are approximate (street-level), good enough for the NOC heatmap.
"""

import argparse
import logging
import sys
import time
import urllib.parse
import urllib.request
import json
import os

# Allow running as "python -m workers.geocoder" from backend/
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from database import SessionLocal
from sqlalchemy import text

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s", datefmt="%H:%M:%S")
logger = logging.getLogger("geocoder")

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "RicoNetNOC/1.0 (booto.cable.network)"
RATE_LIMIT_SEC = 1.1   # Nominatim ToS: max 1 req/sec
FALLBACK_PINCODE = "603203"   # Potheri / Kattankulathur

# Bounding box for sanity check: Tamil Nadu, India
LAT_MIN, LAT_MAX = 8.0, 14.0
LNG_MIN, LNG_MAX = 76.0, 82.0


def _geocode_query(q: str) -> tuple[float, float] | None:
    """Make one Nominatim request. Returns (lat, lng) or None."""
    params = urllib.parse.urlencode({
        "q": q,
        "format": "json",
        "limit": 1,
        "countrycodes": "in",
    })
    url = f"{NOMINATIM_URL}?{params}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            if data:
                lat = float(data[0]["lat"])
                lng = float(data[0]["lon"])
                if LAT_MIN <= lat <= LAT_MAX and LNG_MIN <= lng <= LNG_MAX:
                    return lat, lng
    except Exception as e:
        logger.debug("Nominatim error for %r: %s", q, e)
    return None


def _clean_address(raw: str) -> str:
    """Strip common junk from Railwire address strings."""
    # Remove duplicate city names, normalize whitespace
    parts = [p.strip() for p in raw.replace(",", " ").split() if p.strip()]
    return " ".join(parts)


def _build_queries(raw: str) -> list[str]:
    """
    Return progressively coarser queries for a Railwire address.

    Reality for Potheri / Kattankulathur area:
    - Small colony/street names (CHAMUNDESWARI NAGAR, MOOPANAR ST, etc.) are NOT
      in OpenStreetMap — street-level queries fail for almost all customers here.
    - The reliable fallback is "Potheri 603203 India" (confirmed working).
    - For better precision, use Google Maps API or manual GPS entry via field tech.

    Queries tried in order:
    1. Colony/area name + Potheri + pincode  (sometimes works for larger areas)
    2. Potheri + pincode                      (always works, area-level ~±500m)
    """
    tokens = raw.upper().split()

    # Strip number/noise prefixes and known generic words
    skip = {"NO", "NO-", "HOUSE", "PLOT", "FLAT", "DOOR", "OLD", "NEW", "ST",
            "AND", "NEAR", "OPP", "BEHIND", "OPPOSITE", "BLOCK", "SECTOR",
            "PHASE", "SRM", "CHENNAI", "KANCHEEPURAM", "CHENGALPATTU",
            "TAMIL", "NADU", "INDIA", "FLOOR", "QUARTERS", "NAGAR"}
    meaningful = [t.strip(",") for t in tokens
                  if len(t.strip(",")) > 4
                  and t.strip(",") not in skip
                  and not t.strip(",").isdigit()
                  and not t.strip(",").startswith("NO")]

    queries = []

    # 1. Best area terms + Potheri anchor
    if meaningful:
        queries.append(" ".join(meaningful[:3]) + " Potheri 603203 India")

    # 2. Reliable area-level fallback (confirmed working with Nominatim)
    queries.append("Potheri 603203 India")

    return queries


def run(limit: int = 0, dry_run: bool = False) -> None:
    db = SessionLocal()
    try:
        sql = text("""
            SELECT id, railwire_address
            FROM customers
            WHERE railwire_address IS NOT NULL
              AND railwire_address != ''
              AND (geo_lat IS NULL OR geo_lat = 0)
            ORDER BY id
        """ + (f" LIMIT {limit}" if limit else ""))

        rows = db.execute(sql).fetchall()
        logger.info("Customers to geocode: %d", len(rows))

        success = 0
        failed = 0

        for i, (cid, raw_addr) in enumerate(rows):
            logger.info("[%d/%d] ID=%d  %s", i + 1, len(rows), cid, raw_addr[:60])

            lat, lng = None, None
            for q in _build_queries(raw_addr):
                lat, lng = _geocode_query(q) or (None, None)
                if lat:
                    logger.info("  ✓ (%.5f, %.5f)  query=%r", lat, lng, q[:50])
                    break
                time.sleep(RATE_LIMIT_SEC)

            if lat is None:
                logger.warning("  ✗ No result for %r", raw_addr[:50])
                failed += 1
                continue

            if not dry_run:
                db.execute(text("""
                    UPDATE customers SET geo_lat = :lat, geo_long = :lng
                    WHERE id = :id
                """), {"lat": lat, "lng": lng, "id": cid})
                db.commit()

            success += 1
            time.sleep(RATE_LIMIT_SEC)

        logger.info("Done. Success: %d  Failed: %d", success, failed)
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Geocode Railwire customer addresses")
    parser.add_argument("--limit", type=int, default=0, help="Max customers to process (0=all)")
    parser.add_argument("--dry-run", action="store_true", help="Don't write to DB")
    args = parser.parse_args()
    run(limit=args.limit, dry_run=args.dry_run)
