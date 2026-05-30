"""008 - collector health metadata

Revision ID: 008
Revises: 007
Create Date: 2026-04-28
"""
from alembic import op


revision = "008"
down_revision = "007"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        ALTER TABLE olt_health
            ADD COLUMN IF NOT EXISTS collector_id VARCHAR(80),
            ADD COLUMN IF NOT EXISTS collector_name VARCHAR(120),
            ADD COLUMN IF NOT EXISTS collector_hostname VARCHAR(120),
            ADD COLUMN IF NOT EXISTS collector_ip VARCHAR(45),
            ADD COLUMN IF NOT EXISTS collector_version VARCHAR(40),
            ADD COLUMN IF NOT EXISTS collector_started_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS last_collector_seen_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS last_batch_size INTEGER
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_olt_health_collector_id ON olt_health(collector_id)")


def downgrade():
    op.execute("DROP INDEX IF EXISTS idx_olt_health_collector_id")
    op.execute("""
        ALTER TABLE olt_health
            DROP COLUMN IF EXISTS last_batch_size,
            DROP COLUMN IF EXISTS last_collector_seen_at,
            DROP COLUMN IF EXISTS collector_started_at,
            DROP COLUMN IF EXISTS collector_version,
            DROP COLUMN IF EXISTS collector_ip,
            DROP COLUMN IF EXISTS collector_hostname,
            DROP COLUMN IF EXISTS collector_name,
            DROP COLUMN IF EXISTS collector_id
    """)
