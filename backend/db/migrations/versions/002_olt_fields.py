"""Add OLT fields and first OLT event tables

Revision ID: 002
Revises: 001
Create Date: 2026-03-26
"""
from typing import Sequence, Union

from alembic import op


revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE customers
            ADD COLUMN IF NOT EXISTS olt_host VARCHAR(45),
            ADD COLUMN IF NOT EXISTS pon_port VARCHAR(20),
            ADD COLUMN IF NOT EXISTS onu_index INTEGER
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS onu_snapshots (
            id BIGSERIAL PRIMARY KEY,
            mac_address VARCHAR(64) NOT NULL,
            olt_host VARCHAR(45),
            pon_port VARCHAR(20),
            onu_index INTEGER,
            status VARCHAR(10),
            rx_power_dbm FLOAT,
            tx_power_dbm FLOAT,
            temperature_c FLOAT,
            voltage_mv INTEGER,
            flap_count INTEGER,
            dying_gasp BOOLEAN NOT NULL DEFAULT FALSE,
            distance_m INTEGER,
            rx_bytes_delta BIGINT,
            tx_bytes_delta BIGINT,
            polled_at TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_onu_snapshots_mac_address ON onu_snapshots (mac_address)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_onu_snapshots_polled_at ON onu_snapshots (polled_at)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_onu_snapshots_mac_polled ON onu_snapshots (mac_address, polled_at)")
    op.execute("""
        CREATE TABLE IF NOT EXISTS alarm_events (
            id SERIAL PRIMARY KEY,
            mac_address VARCHAR(64) NOT NULL,
            event_type VARCHAR(50) NOT NULL,
            olt_host VARCHAR(45),
            pon_port VARCHAR(20),
            onu_index INTEGER,
            payload JSONB,
            auto_ticket_id INTEGER,
            received_at TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_alarm_events_mac_address ON alarm_events (mac_address)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_alarm_events_received_at ON alarm_events (received_at)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS alarm_events")
    op.execute("DROP TABLE IF EXISTS onu_snapshots")
    op.execute("""
        ALTER TABLE customers
            DROP COLUMN IF EXISTS onu_index,
            DROP COLUMN IF EXISTS pon_port,
            DROP COLUMN IF EXISTS olt_host
    """)
