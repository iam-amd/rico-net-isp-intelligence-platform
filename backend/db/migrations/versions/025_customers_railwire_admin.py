"""025 - customers.railwire_admin (per-account tagging in Postgres)

Revision ID: 025
Revises: 024
Create Date: 2026-05-22

The scraper SQLite has tagged each customer with the Railwire admin account it
came from since day one, but Postgres `customers` had no such column. Adds it,
indexes it, and backfills from the scraper SQLite on the same host (best-effort
— skipped if the SQLite file isn't reachable).

After this migration, sync_daemon should keep the column current. The /pipeline
page can now show per-account customer lists from Postgres directly.
"""
import logging
import os
import sqlite3

import sqlalchemy as sa
from alembic import op


revision = "025"
down_revision = "024"
branch_labels = None
depends_on = None

logger = logging.getLogger("alembic.runtime.migration")


def upgrade():
    op.execute("ALTER TABLE customers ADD COLUMN IF NOT EXISTS railwire_admin VARCHAR(80)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_customers_railwire_admin ON customers (railwire_admin)")

    # Best-effort backfill from scraper SQLite on the same host. Migration must
    # succeed even if the file isn't there (e.g., a fresh dev box).
    sqlite_path = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "scraper", "rico_net.db")
    )
    if not os.path.exists(sqlite_path):
        logger.info("025 backfill skipped — scraper SQLite not found at %s", sqlite_path)
        return

    try:
        sconn = sqlite3.connect(f"file:{sqlite_path}?mode=ro", uri=True, timeout=5)
        rows = sconn.execute(
            "SELECT username, railwire_admin FROM customers "
            "WHERE railwire_admin IS NOT NULL AND railwire_admin != '' AND railwire_admin != 'default'"
        ).fetchall()
        sconn.close()
    except sqlite3.Error as exc:
        logger.warning("025 backfill: could not read scraper SQLite: %s", exc)
        return

    if not rows:
        logger.info("025 backfill: no tagged rows in scraper SQLite, nothing to backfill")
        return

    conn = op.get_bind()
    updated = 0
    for username, admin in rows:
        result = conn.execute(
            sa.text("UPDATE customers SET railwire_admin = :a WHERE username = :u AND railwire_admin IS NULL"),
            {"a": admin, "u": username},
        )
        updated += result.rowcount or 0
    logger.info("025 backfill: tagged %d Postgres customer rows with railwire_admin", updated)


def downgrade():
    op.execute("DROP INDEX IF EXISTS idx_customers_railwire_admin")
    op.execute("ALTER TABLE customers DROP COLUMN IF EXISTS railwire_admin")
