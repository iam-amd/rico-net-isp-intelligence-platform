"""019 - customer sync state

Revision ID: 019
Revises: 018
Create Date: 2026-05-11
"""
from alembic import op


revision = "019"
down_revision = "018"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE IF NOT EXISTS customer_sync_state (
            customer_id VARCHAR NOT NULL REFERENCES customers(username) ON DELETE CASCADE,
            source VARCHAR(40) NOT NULL DEFAULT 'railwire_scraper',
            last_csv_synced_at TIMESTAMPTZ,
            last_details_synced_at TIMESTAMPTZ,
            last_mac_synced_at TIMESTAMPTZ,
            source_updated_at TIMESTAMPTZ,
            last_synced_at TIMESTAMPTZ,
            last_status VARCHAR(30) NOT NULL DEFAULT 'success',
            last_error TEXT,
            error_count INTEGER NOT NULL DEFAULT 0,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (customer_id)
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_customer_sync_state_status
            ON customer_sync_state (last_status, updated_at DESC)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_customer_sync_state_source_updated
            ON customer_sync_state (source_updated_at DESC)
    """)


def downgrade():
    op.execute("DROP INDEX IF EXISTS idx_customer_sync_state_source_updated")
    op.execute("DROP INDEX IF EXISTS idx_customer_sync_state_status")
    op.execute("DROP TABLE IF EXISTS customer_sync_state")
