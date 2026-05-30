"""026 - customers.railwire_status (draft = removed from Railwire)

Revision ID: 026
Revises: 025
Create Date: 2026-05-22

Distinguishes:
  - railwire_status = 'active'    → customer is still in the Railwire portal
  - railwire_status = 'not_found' → Railwire deleted/dropped them from the account
                                    (user's "draft" customers — kept locally for history)

Previously this distinction lived only in scraper SQLite. Postgres collapsed
both into connection_status='inactive', which conflated "Railwire removed them"
with "active subscriber whose plan expired". Adding the raw flag here.
"""
import logging
import os
import sqlite3

import sqlalchemy as sa
from alembic import op


revision = "026"
down_revision = "025"
branch_labels = None
depends_on = None

logger = logging.getLogger("alembic.runtime.migration")


def upgrade():
    op.execute("ALTER TABLE customers ADD COLUMN IF NOT EXISTS railwire_status VARCHAR(20) DEFAULT 'active'")
    op.execute("CREATE INDEX IF NOT EXISTS idx_customers_railwire_status ON customers (railwire_status)")

    sqlite_path = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "scraper", "rico_net.db")
    )
    if not os.path.exists(sqlite_path):
        logger.info("026 backfill skipped — scraper SQLite not found at %s", sqlite_path)
        return

    try:
        sconn = sqlite3.connect(f"file:{sqlite_path}?mode=ro", uri=True, timeout=5)
        rows = sconn.execute(
            "SELECT username, railwire_status FROM customers "
            "WHERE railwire_status IS NOT NULL AND railwire_status != ''"
        ).fetchall()
        sconn.close()
    except sqlite3.Error as exc:
        logger.warning("026 backfill: could not read scraper SQLite: %s", exc)
        return

    if not rows:
        logger.info("026 backfill: no rows to backfill")
        return

    conn = op.get_bind()
    updated = 0
    for username, status in rows:
        result = conn.execute(
            sa.text("UPDATE customers SET railwire_status = :s WHERE username = :u"),
            {"s": status, "u": username},
        )
        updated += result.rowcount or 0
    logger.info("026 backfill: set railwire_status on %d Postgres customer rows", updated)


def downgrade():
    op.execute("DROP INDEX IF EXISTS idx_customers_railwire_status")
    op.execute("ALTER TABLE customers DROP COLUMN IF EXISTS railwire_status")
