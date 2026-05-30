"""032 - ont_serial_number on onu_latest + onu_snapshots

Revision ID: 032
Revises: 031
Create Date: 2026-05-24

The Pi poller already collects the ONT serial number for every GPON ONU via
`show onu info all` and ships it inside each snapshot payload's `serial_number`
field. The backend just had nowhere to store it.

Adding the column lets us:
  * Persist the canonical ONT identity per slot (one SN per ONU, stable across
    MAC/firmware/router changes — only changes when the device itself is swapped)
  * Auto-fill customers.ont_serial_number via the profile enricher
  * Eliminate the dependency on field-tech sticker scans for SN capture (~1064
    customers will get SN automatically; field scans only needed for the 200
    customers on EPON .100 which doesn't expose SN by default)

Also adds an index for fast lookup-by-slot during enrichment.
"""
from alembic import op


revision = "032"
down_revision = "031"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        ALTER TABLE onu_latest
        ADD COLUMN IF NOT EXISTS ont_serial_number VARCHAR(64)
    """)
    op.execute("""
        ALTER TABLE onu_snapshots
        ADD COLUMN IF NOT EXISTS ont_serial_number VARCHAR(64)
    """)
    # Fast lookup for the enricher: customer at (olt, port, index) → SN
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_onu_latest_slot_sn
            ON onu_latest (olt_host, pon_port, onu_index)
            WHERE ont_serial_number IS NOT NULL
    """)


def downgrade():
    op.execute("DROP INDEX IF EXISTS idx_onu_latest_slot_sn")
    op.execute("ALTER TABLE onu_snapshots DROP COLUMN IF EXISTS ont_serial_number")
    op.execute("ALTER TABLE onu_latest DROP COLUMN IF EXISTS ont_serial_number")
