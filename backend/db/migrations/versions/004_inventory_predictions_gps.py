"""device inventory + predictions + tech_locations

Revision ID: 004
Revises: 003
Create Date: 2026-04-04
"""
from alembic import op


revision = "004"
down_revision = "003"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        ALTER TABLE onu_latest
            ADD COLUMN IF NOT EXISTS vendor_id VARCHAR(20),
            ADD COLUMN IF NOT EXISTS model_id VARCHAR(20),
            ADD COLUMN IF NOT EXISTS hw_version VARCHAR(20),
            ADD COLUMN IF NOT EXISTS sw_version VARCHAR(30)
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS predictions (
            mac_address VARCHAR(64) PRIMARY KEY,
            olt_host VARCHAR(45),
            pon_port VARCHAR(20),
            rx_slope_7d FLOAT,
            rx_avg_7d FLOAT,
            alarm_count_30d INTEGER NOT NULL DEFAULT 0,
            offline_count_30d INTEGER NOT NULL DEFAULT 0,
            fiber_risk VARCHAR(10),
            churn_risk VARCHAR(10),
            health_score INTEGER NOT NULL DEFAULT 100,
            recommended_action VARCHAR(150),
            customer_name VARCHAR(120),
            customer_phone VARCHAR(20),
            last_computed TIMESTAMPTZ
        )
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS tech_locations (
            id SERIAL PRIMARY KEY,
            technician_id INTEGER NOT NULL REFERENCES technicians(id),
            lat FLOAT NOT NULL,
            lng FLOAT NOT NULL,
            accuracy_m FLOAT,
            battery_pct INTEGER,
            timestamp TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_tech_locations_technician_id ON tech_locations (technician_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_tech_locations_timestamp ON tech_locations (timestamp)")


def downgrade():
    op.execute("DROP INDEX IF EXISTS ix_tech_locations_timestamp")
    op.execute("DROP INDEX IF EXISTS ix_tech_locations_technician_id")
    op.execute("DROP TABLE IF EXISTS tech_locations")
    op.execute("DROP TABLE IF EXISTS predictions")
    op.execute("""
        ALTER TABLE onu_latest
            DROP COLUMN IF EXISTS sw_version,
            DROP COLUMN IF EXISTS hw_version,
            DROP COLUMN IF EXISTS model_id,
            DROP COLUMN IF EXISTS vendor_id
    """)
