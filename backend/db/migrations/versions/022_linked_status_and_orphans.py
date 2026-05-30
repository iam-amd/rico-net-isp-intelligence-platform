"""022 - link_status + linked_at + last_verified_at + orphan_onus

Revision ID: 022
Revises: 021
Create Date: 2026-05-21

Conceptual change:
- customer_dna.link_status (linked | unlinked) is the AUTHORITATIVE status.
- linked_at = when the link was first established (immutable until link breaks).
- last_verified_at = last successful PON MAC walk that confirmed the link.
- unlink_reason = only set when link_status='unlinked'.

binding_source / confidence are retained for backward compat but should be
treated as derived metadata, not the source of truth.

New table:
- orphan_onus = MACs visible in an OLT PON MAC table but with no matching
  Railwire customer. These are devices that exist on the network but Railwire
  doesn't know about them.
"""
from alembic import op


revision = "022"
down_revision = "021"
branch_labels = None
depends_on = None


def upgrade():
    # link status fields
    op.execute("""
        ALTER TABLE customer_dna
        ADD COLUMN IF NOT EXISTS link_status        VARCHAR(15),
        ADD COLUMN IF NOT EXISTS linked_at          TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS last_verified_at   TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS unlink_reason      VARCHAR(40)
    """)

    # backfill: anything with olt_host considered "linked"
    op.execute("""
        UPDATE customer_dna
        SET link_status = CASE
              WHEN olt_host IS NOT NULL THEN 'linked'
              ELSE 'unlinked'
            END,
            linked_at = COALESCE(last_reconciled_at, NOW()),
            last_verified_at = CASE
              WHEN binding_source IN ('pon_mac_table', 'sticker_scan')
                THEN last_reconciled_at
              ELSE NULL
            END,
            unlink_reason = CASE
              WHEN olt_host IS NULL THEN unmatched_reason
              ELSE NULL
            END
    """)

    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_customer_dna_link_status
            ON customer_dna (link_status)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_customer_dna_last_verified
            ON customer_dna (last_verified_at DESC NULLS LAST)
    """)

    # orphan ONU table (MACs in OLT without a customer)
    op.execute("""
        CREATE TABLE IF NOT EXISTS orphan_onus (
            mac_address     VARCHAR(17) NOT NULL,
            olt_host        VARCHAR(45) NOT NULL,
            pon_port        VARCHAR(20) NOT NULL,
            onu_index       INTEGER NOT NULL,
            first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            rx_power_dbm    DOUBLE PRECISION,
            tx_power_dbm    DOUBLE PRECISION,
            status          VARCHAR(10),
            notes           TEXT,
            PRIMARY KEY (mac_address, olt_host)
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_orphan_onus_olt
            ON orphan_onus (olt_host, last_seen_at DESC)
    """)


def downgrade():
    op.execute("DROP TABLE IF EXISTS orphan_onus")
    op.execute("DROP INDEX IF EXISTS idx_customer_dna_last_verified")
    op.execute("DROP INDEX IF EXISTS idx_customer_dna_link_status")
    op.execute("ALTER TABLE customer_dna DROP COLUMN IF EXISTS unlink_reason")
    op.execute("ALTER TABLE customer_dna DROP COLUMN IF EXISTS last_verified_at")
    op.execute("ALTER TABLE customer_dna DROP COLUMN IF EXISTS linked_at")
    op.execute("ALTER TABLE customer_dna DROP COLUMN IF EXISTS link_status")
