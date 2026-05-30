"""012 - PG device setup and full sticker OCR data

Revision ID: 012
Revises: 011
Create Date: 2026-04-30
"""
from alembic import op


revision = "012"
down_revision = "011"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        ALTER TABLE pg_rooms
            ADD COLUMN IF NOT EXISTS device_setup VARCHAR(20),
            ADD COLUMN IF NOT EXISTS ont_sticker_data JSONB,
            ADD COLUMN IF NOT EXISTS router_sticker_data JSONB
    """)
    op.execute("""
        ALTER TABLE customers
            ADD COLUMN IF NOT EXISTS device_setup VARCHAR(20),
            ADD COLUMN IF NOT EXISTS ont_sticker_data JSONB,
            ADD COLUMN IF NOT EXISTS router_sticker_data JSONB
    """)
    op.execute("""
        UPDATE pg_rooms
        SET device_setup = CASE
            WHEN router_mac_address IS NOT NULL OR router_serial IS NOT NULL OR router_model IS NOT NULL
                THEN 'onu_router'
            ELSE 'single_ont'
        END
        WHERE device_setup IS NULL
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_pg_rooms_device_setup ON pg_rooms(device_setup)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_customers_device_setup ON customers(device_setup)")


def downgrade():
    op.execute("DROP INDEX IF EXISTS idx_customers_device_setup")
    op.execute("DROP INDEX IF EXISTS idx_pg_rooms_device_setup")
    op.execute("""
        ALTER TABLE customers
            DROP COLUMN IF EXISTS router_sticker_data,
            DROP COLUMN IF EXISTS ont_sticker_data,
            DROP COLUMN IF EXISTS device_setup
    """)
    op.execute("""
        ALTER TABLE pg_rooms
            DROP COLUMN IF EXISTS router_sticker_data,
            DROP COLUMN IF EXISTS ont_sticker_data,
            DROP COLUMN IF EXISTS device_setup
    """)
