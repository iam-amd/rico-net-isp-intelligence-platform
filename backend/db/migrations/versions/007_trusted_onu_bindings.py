"""007 - trusted ONU binding fields

Revision ID: 007
Revises: 006
Create Date: 2026-04-27
"""
from alembic import op


revision = "007"
down_revision = "006"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        ALTER TABLE onu_bindings
            ADD COLUMN IF NOT EXISTS primary_identifier_type VARCHAR(10),
            ADD COLUMN IF NOT EXISTS serial_number VARCHAR(64),
            ADD COLUMN IF NOT EXISTS mac_address VARCHAR(64),
            ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
            ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS deactivated_reason VARCHAR(120),
            ADD COLUMN IF NOT EXISTS sticker_photo_url VARCHAR(500)
    """)
    op.execute("""
        UPDATE onu_bindings
        SET
            primary_identifier_type = COALESCE(
                primary_identifier_type,
                CASE WHEN onu_type = 'epon' THEN 'mac' ELSE 'serial' END
            ),
            serial_number = COALESCE(
                serial_number,
                CASE WHEN onu_type = 'gpon' THEN REPLACE(UPPER(onu_identifier), 'SN:', '') ELSE NULL END
            ),
            mac_address = COALESCE(
                mac_address,
                CASE WHEN onu_type = 'epon' THEN UPPER(onu_identifier) ELSE NULL END
            ),
            verified_at = COALESCE(verified_at, last_seen, first_seen),
            is_active = COALESCE(is_active, TRUE)
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_onu_bindings_active_customer ON onu_bindings(customer_id) WHERE is_active = TRUE")
    op.execute("CREATE INDEX IF NOT EXISTS idx_onu_bindings_active_identifier ON onu_bindings(onu_type, onu_identifier) WHERE is_active = TRUE")
    op.execute("CREATE INDEX IF NOT EXISTS idx_onu_bindings_active_serial ON onu_bindings(serial_number) WHERE is_active = TRUE AND serial_number IS NOT NULL")
    op.execute("CREATE INDEX IF NOT EXISTS idx_onu_bindings_active_mac ON onu_bindings(mac_address) WHERE is_active = TRUE AND mac_address IS NOT NULL")
    op.execute("CREATE INDEX IF NOT EXISTS idx_onu_bindings_active_placement ON onu_bindings(olt_host, pon_port, onu_index) WHERE is_active = TRUE")


def downgrade():
    op.execute("DROP INDEX IF EXISTS idx_onu_bindings_active_placement")
    op.execute("DROP INDEX IF EXISTS idx_onu_bindings_active_mac")
    op.execute("DROP INDEX IF EXISTS idx_onu_bindings_active_serial")
    op.execute("DROP INDEX IF EXISTS idx_onu_bindings_active_identifier")
    op.execute("DROP INDEX IF EXISTS idx_onu_bindings_active_customer")
    op.execute("""
        ALTER TABLE onu_bindings
            DROP COLUMN IF EXISTS sticker_photo_url,
            DROP COLUMN IF EXISTS deactivated_reason,
            DROP COLUMN IF EXISTS deactivated_at,
            DROP COLUMN IF EXISTS is_active,
            DROP COLUMN IF EXISTS verified_at,
            DROP COLUMN IF EXISTS mac_address,
            DROP COLUMN IF EXISTS serial_number,
            DROP COLUMN IF EXISTS primary_identifier_type
    """)
