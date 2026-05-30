"""017 - OLT maintenance windows

Revision ID: 017
Revises: 016
Create Date: 2026-05-11
"""
from alembic import op


revision = "017"
down_revision = "016"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE IF NOT EXISTS olt_maintenance_windows (
            id SERIAL PRIMARY KEY,
            olt_host VARCHAR(45) NOT NULL,
            pon_port VARCHAR(20),
            starts_at TIMESTAMPTZ NOT NULL,
            ends_at TIMESTAMPTZ NOT NULL,
            reason TEXT,
            created_by INTEGER,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            cancelled_at TIMESTAMPTZ,
            cancelled_by INTEGER,
            CONSTRAINT ck_olt_maintenance_window_time
                CHECK (ends_at > starts_at)
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_olt_maintenance_windows_scope
            ON olt_maintenance_windows (olt_host, pon_port, starts_at, ends_at)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_olt_maintenance_windows_active
            ON olt_maintenance_windows (olt_host, ends_at)
            WHERE is_active = TRUE
    """)


def downgrade():
    op.execute("DROP INDEX IF EXISTS idx_olt_maintenance_windows_active")
    op.execute("DROP INDEX IF EXISTS idx_olt_maintenance_windows_scope")
    op.execute("DROP TABLE IF EXISTS olt_maintenance_windows")
