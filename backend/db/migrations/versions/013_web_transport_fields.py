"""013 - Web transport extra fields on onu_latest and onu_snapshots

Adds columns populated by the HTTP web portal transport (web_client.py):
  onu_latest:    deregister_reason, alive_time_sec, rtt_ns, tx_bias_current_ma
  onu_snapshots: alive_time_sec, rtt_ns, tx_bias_current_ma

Revision ID: 013
Revises: 012
Create Date: 2026-05-03
"""
from alembic import op


revision = "013"
down_revision = "012"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        ALTER TABLE onu_latest
            ADD COLUMN IF NOT EXISTS deregister_reason  VARCHAR(50),
            ADD COLUMN IF NOT EXISTS alive_time_sec     INTEGER,
            ADD COLUMN IF NOT EXISTS rtt_ns             BIGINT,
            ADD COLUMN IF NOT EXISTS tx_bias_current_ma FLOAT;

        ALTER TABLE onu_snapshots
            ADD COLUMN IF NOT EXISTS alive_time_sec     INTEGER,
            ADD COLUMN IF NOT EXISTS rtt_ns             BIGINT,
            ADD COLUMN IF NOT EXISTS tx_bias_current_ma FLOAT;
    """)


def downgrade():
    op.execute("""
        ALTER TABLE onu_latest
            DROP COLUMN IF EXISTS deregister_reason,
            DROP COLUMN IF EXISTS alive_time_sec,
            DROP COLUMN IF EXISTS rtt_ns,
            DROP COLUMN IF EXISTS tx_bias_current_ma;

        ALTER TABLE onu_snapshots
            DROP COLUMN IF EXISTS alive_time_sec,
            DROP COLUMN IF EXISTS rtt_ns,
            DROP COLUMN IF EXISTS tx_bias_current_ma;
    """)
