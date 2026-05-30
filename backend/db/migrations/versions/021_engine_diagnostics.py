"""021 - engine diagnostics (unmatched_reason + run log + state changes)

Revision ID: 021
Revises: 020
Create Date: 2026-05-21

Three additions to support engine observability:
  1. customer_dna.unmatched_reason  — categorize the gap
  2. engine_reconcile_runs           — per-cycle run log
  3. engine_state_changes            — per-customer event feed (binding flips)
"""
from alembic import op


revision = "021"
down_revision = "020"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        ALTER TABLE customer_dna
        ADD COLUMN IF NOT EXISTS unmatched_reason VARCHAR(40)
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS engine_reconcile_runs (
            id                  SERIAL PRIMARY KEY,
            started_at          TIMESTAMPTZ NOT NULL,
            finished_at         TIMESTAMPTZ,
            duration_seconds    DOUBLE PRECISION,
            ok                  BOOLEAN NOT NULL DEFAULT TRUE,
            error               TEXT,

            customers_total     INTEGER NOT NULL DEFAULT 0,
            customers_resolved  INTEGER NOT NULL DEFAULT 0,
            customers_unmatched INTEGER NOT NULL DEFAULT 0,
            unified_mac_count   INTEGER NOT NULL DEFAULT 0,
            changes_count       INTEGER NOT NULL DEFAULT 0,

            -- per-OLT stats
            olt_100_pon_mac     INTEGER,
            olt_100_optical     INTEGER,
            olt_100_error       TEXT,
            olt_200_pon_mac     INTEGER,
            olt_200_optical     INTEGER,
            olt_200_error       TEXT,
            olt_210_pon_mac     INTEGER,
            olt_210_optical     INTEGER,
            olt_210_error       TEXT
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_engine_runs_started_at
            ON engine_reconcile_runs (started_at DESC)
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS engine_state_changes (
            id                  BIGSERIAL PRIMARY KEY,
            occurred_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            run_id              INTEGER REFERENCES engine_reconcile_runs(id) ON DELETE SET NULL,
            username            VARCHAR NOT NULL,
            change_type         VARCHAR(30) NOT NULL,  -- resolved | unresolved | position_changed | online_to_offline | offline_to_online | dying_gasp | source_changed | confidence_changed
            from_value          VARCHAR(120),
            to_value            VARCHAR(120),
            note                TEXT
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_engine_changes_username_occurred
            ON engine_state_changes (username, occurred_at DESC)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_engine_changes_occurred
            ON engine_state_changes (occurred_at DESC)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_engine_changes_type
            ON engine_state_changes (change_type, occurred_at DESC)
    """)


def downgrade():
    op.execute("DROP TABLE IF EXISTS engine_state_changes")
    op.execute("DROP TABLE IF EXISTS engine_reconcile_runs")
    op.execute("ALTER TABLE customer_dna DROP COLUMN IF EXISTS unmatched_reason")
