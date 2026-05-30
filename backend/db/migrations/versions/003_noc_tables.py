"""Create onu_latest table for NOC Dashboard

Revision ID: 003
Revises: 002
Create Date: 2026-03-29
"""
from typing import Sequence, Union

from alembic import op


revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS onu_latest (
            mac_address VARCHAR(64) PRIMARY KEY,
            olt_host VARCHAR(45) NOT NULL,
            pon_port VARCHAR(20),
            onu_index INTEGER,
            status VARCHAR(10),
            rx_power_dbm FLOAT,
            tx_power_dbm FLOAT,
            temperature_c FLOAT,
            voltage_mv INTEGER,
            dying_gasp BOOLEAN NOT NULL DEFAULT FALSE,
            polled_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_onu_latest_pon_port ON onu_latest (pon_port)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_onu_latest_status ON onu_latest (status)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_onu_latest_olt_host ON onu_latest (olt_host)")
    op.execute("""
        INSERT INTO onu_latest (mac_address, olt_host, pon_port, onu_index, status,
                                rx_power_dbm, tx_power_dbm, temperature_c, voltage_mv,
                                dying_gasp, polled_at)
        SELECT DISTINCT ON (mac_address)
            mac_address, COALESCE(olt_host, ''), pon_port, onu_index, status,
            rx_power_dbm, tx_power_dbm, temperature_c, voltage_mv,
            dying_gasp, polled_at
        FROM onu_snapshots
        WHERE mac_address IS NOT NULL
        ORDER BY mac_address, polled_at DESC
        ON CONFLICT (mac_address) DO NOTHING
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS onu_latest")
