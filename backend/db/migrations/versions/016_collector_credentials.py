"""016 - per-collector ingest credentials

Revision ID: 016
Revises: 015
Create Date: 2026-05-11
"""
from alembic import op


revision = "016"
down_revision = "015"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE IF NOT EXISTS collector_credentials (
            collector_id VARCHAR(80) PRIMARY KEY,
            token_hash VARCHAR(64) NOT NULL,
            token_last_four VARCHAR(8),
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            rotated_at TIMESTAMPTZ
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_collector_credentials_active
            ON collector_credentials (collector_id)
            WHERE is_active = TRUE
    """)


def downgrade():
    op.execute("DROP INDEX IF EXISTS idx_collector_credentials_active")
    op.execute("DROP TABLE IF EXISTS collector_credentials")
