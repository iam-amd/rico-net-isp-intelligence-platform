"""015 - alarm operator action fields

Revision ID: 015
Revises: 014
Create Date: 2026-05-11

Adds NOC operator action fields to alarm_events so alarms can be
acknowledged, suppressed, resolved, and linked with auditable context.
"""
from alembic import op


revision = "015"
down_revision = "014"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        ALTER TABLE alarm_events
            ADD COLUMN IF NOT EXISTS acknowledged_by INTEGER,
            ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS suppressed_until TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS resolution_reason VARCHAR(120),
            ADD COLUMN IF NOT EXISTS operator_note TEXT
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_alarm_events_suppressed_until
            ON alarm_events (suppressed_until)
            WHERE suppressed_until IS NOT NULL
    """)


def downgrade():
    op.execute("DROP INDEX IF EXISTS idx_alarm_events_suppressed_until")
    op.execute("""
        ALTER TABLE alarm_events
            DROP COLUMN IF EXISTS operator_note,
            DROP COLUMN IF EXISTS resolution_reason,
            DROP COLUMN IF EXISTS suppressed_until,
            DROP COLUMN IF EXISTS acknowledged_at,
            DROP COLUMN IF EXISTS acknowledged_by
    """)
