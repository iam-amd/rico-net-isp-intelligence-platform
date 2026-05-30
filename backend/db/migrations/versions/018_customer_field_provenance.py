"""018 - customer field provenance

Revision ID: 018
Revises: 017
Create Date: 2026-05-11
"""
from alembic import op


revision = "018"
down_revision = "017"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE IF NOT EXISTS customer_field_provenance (
            customer_id VARCHAR NOT NULL REFERENCES customers(username) ON DELETE CASCADE,
            field_name VARCHAR(80) NOT NULL,
            source VARCHAR(40) NOT NULL,
            source_rank INTEGER NOT NULL DEFAULT 0,
            writer VARCHAR(80),
            evidence_ref VARCHAR(500),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            verified_at TIMESTAMPTZ,
            notes TEXT,
            PRIMARY KEY (customer_id, field_name)
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_customer_field_provenance_source
            ON customer_field_provenance (source, updated_at DESC)
    """)


def downgrade():
    op.execute("DROP INDEX IF EXISTS idx_customer_field_provenance_source")
    op.execute("DROP TABLE IF EXISTS customer_field_provenance")
