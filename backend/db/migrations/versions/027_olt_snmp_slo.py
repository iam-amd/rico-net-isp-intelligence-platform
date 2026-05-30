"""027 - per-OLT SNMP freshness SLO thresholds

Revision ID: 027
Revises: 026
Create Date: 2026-05-22

GPON-Booto-210 runs Netlink V1.4.8R, a slow SNMP agent serving ~1,285 ONUs.
Full optical walks take 30-90s, so a uniform 5min/15min warn/critical threshold
flashes amber even when the OLT is healthy and just busy.

Adds per-OLT thresholds in olt_registry and bumps .210's warn/critical to
10min/25min so its normal cadence shows green.
"""
from alembic import op


revision = "027"
down_revision = "026"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        ALTER TABLE olt_registry
        ADD COLUMN IF NOT EXISTS snmp_slo_warn_sec     INTEGER NOT NULL DEFAULT 300,
        ADD COLUMN IF NOT EXISTS snmp_slo_critical_sec INTEGER NOT NULL DEFAULT 900
    """)
    # .210 is the slow one
    op.execute("""
        UPDATE olt_registry
           SET snmp_slo_warn_sec     = 600,
               snmp_slo_critical_sec = 1500
         WHERE host = '10.10.10.210'
    """)


def downgrade():
    op.execute("ALTER TABLE olt_registry DROP COLUMN IF EXISTS snmp_slo_critical_sec")
    op.execute("ALTER TABLE olt_registry DROP COLUMN IF EXISTS snmp_slo_warn_sec")
