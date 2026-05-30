"""029 - mac scrape outcome on customers (attempts + last error)

Revision ID: 029
Revises: 028
Create Date: 2026-05-22

The scraper now records WHY a MAC scrape failed for each customer
(no_mac_on_page / search_timeout / data_usage_link_missing / etc.) plus
the attempt counter. These get propagated by sync_daemon and consumed by
the data-quality classifier so customers don't all get lumped under
"missing MAC".
"""
from alembic import op


revision = "029"
down_revision = "028"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        ALTER TABLE customers
        ADD COLUMN IF NOT EXISTS mac_scrape_attempts  INTEGER     DEFAULT 0,
        ADD COLUMN IF NOT EXISTS mac_last_attempt_at  TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS mac_last_error       VARCHAR(60)
    """)


def downgrade():
    op.execute("ALTER TABLE customers DROP COLUMN IF EXISTS mac_last_error")
    op.execute("ALTER TABLE customers DROP COLUMN IF EXISTS mac_last_attempt_at")
    op.execute("ALTER TABLE customers DROP COLUMN IF EXISTS mac_scrape_attempts")
