"""020 - customer_dna (OLT Engine single-row-per-customer snapshot)

Revision ID: 020
Revises: 019
Create Date: 2026-05-20

The OLT Engine writes one row per customer to this table every reconcile cycle.
All Layer-4 consumers (NOC, mobile, engine page, alerts) read from here so they
see the same picture.
"""
from alembic import op


revision = "020"
down_revision = "019"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE IF NOT EXISTS customer_dna (
            username                    VARCHAR PRIMARY KEY
                                        REFERENCES customers(username) ON DELETE CASCADE,

            railwire_mac                VARCHAR(17),
            sticker_optical_mac         VARCHAR(17),
            sticker_serial              VARCHAR(64),
            router_mac                  VARCHAR(17),

            olt_host                    VARCHAR(45),
            pon_port                    VARCHAR(20),
            onu_index                   INTEGER,
            optical_mac                 VARCHAR(17),
            optical_serial              VARCHAR(64),

            binding_source              VARCHAR(20),
            confidence                  VARCHAR(15),
            railwire_to_optical_offset  INTEGER,

            status                      VARCHAR(10),
            rx_power_dbm                DOUBLE PRECISION,
            tx_power_dbm                DOUBLE PRECISION,
            temperature_c               DOUBLE PRECISION,
            voltage_mv                  INTEGER,
            dying_gasp                  BOOLEAN DEFAULT FALSE,
            polled_at                   TIMESTAMPTZ,

            signal_label                VARCHAR(15),
            fault_type                  VARCHAR(30),
            health_score                INTEGER,

            notes                       TEXT,
            last_reconciled_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_customer_dna_position
            ON customer_dna (olt_host, pon_port, onu_index)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_customer_dna_railwire_mac
            ON customer_dna (railwire_mac)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_customer_dna_confidence
            ON customer_dna (confidence)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_customer_dna_olt_host
            ON customer_dna (olt_host)
    """)


def downgrade():
    op.execute("DROP TABLE IF EXISTS customer_dna")
