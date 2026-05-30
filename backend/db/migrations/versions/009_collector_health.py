"""009 - collector heartbeat health

Revision ID: 009
Revises: 008
Create Date: 2026-04-28
"""
from alembic import op


revision = "009"
down_revision = "008"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE IF NOT EXISTS collector_health (
            collector_id VARCHAR(80) PRIMARY KEY,
            collector_name VARCHAR(120),
            collector_hostname VARCHAR(120),
            collector_ip VARCHAR(45),
            collector_version VARCHAR(40),
            collector_started_at TIMESTAMPTZ,
            last_heartbeat_at TIMESTAMPTZ,
            last_snapshot_at TIMESTAMPTZ,
            last_status VARCHAR(30) NOT NULL DEFAULT 'unknown',
            last_message TEXT,
            backend_url VARCHAR(500),
            configured_olts JSONB,
            last_batch_total INTEGER,
            heartbeat_count INTEGER NOT NULL DEFAULT 0,
            updated_at TIMESTAMPTZ DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_collector_health_last_heartbeat ON collector_health(last_heartbeat_at)")


def downgrade():
    op.execute("DROP INDEX IF EXISTS idx_collector_health_last_heartbeat")
    op.execute("DROP TABLE IF EXISTS collector_health")
