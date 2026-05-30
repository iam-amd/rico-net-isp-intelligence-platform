"""011 - PG room ONT/router sticker identity fields

Revision ID: 011
Revises: 010
Create Date: 2026-04-29
"""
from alembic import op


revision = "011"
down_revision = "010"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        ALTER TABLE pg_rooms
            ADD COLUMN IF NOT EXISTS ont_sticker_photo_url VARCHAR(500),
            ADD COLUMN IF NOT EXISTS router_sticker_photo_url VARCHAR(500),
            ADD COLUMN IF NOT EXISTS router_mac_address VARCHAR(32),
            ADD COLUMN IF NOT EXISTS router_serial VARCHAR(64),
            ADD COLUMN IF NOT EXISTS router_model VARCHAR(64)
    """)
    op.execute("""
        ALTER TABLE customers
            ADD COLUMN IF NOT EXISTS router_mac_address VARCHAR(64)
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_pg_rooms_router_mac ON pg_rooms(router_mac_address)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_customers_router_mac ON customers(router_mac_address)")


def downgrade():
    op.execute("DROP INDEX IF EXISTS idx_customers_router_mac")
    op.execute("DROP INDEX IF EXISTS idx_pg_rooms_router_mac")
    op.execute("""
        ALTER TABLE customers
            DROP COLUMN IF EXISTS router_mac_address
    """)
    op.execute("""
        ALTER TABLE pg_rooms
            DROP COLUMN IF EXISTS router_model,
            DROP COLUMN IF EXISTS router_serial,
            DROP COLUMN IF EXISTS router_mac_address,
            DROP COLUMN IF EXISTS router_sticker_photo_url,
            DROP COLUMN IF EXISTS ont_sticker_photo_url
    """)
