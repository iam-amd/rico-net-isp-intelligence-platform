"""024 - pipeline_runs (backend worker cycle log)

Revision ID: 024
Revises: 023
Create Date: 2026-05-22

One row per background-worker cycle. Lets /pipeline/health show "binding_reconciler
last ran 2 min ago, took 1.4s, processed 941 customers" and flag SLO breaches
when workers stop cycling.
"""
from alembic import op


revision = "024"
down_revision = "023"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE IF NOT EXISTS pipeline_runs (
            id                  BIGSERIAL PRIMARY KEY,
            worker_name         VARCHAR(80) NOT NULL,
            started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            finished_at         TIMESTAMPTZ,
            duration_seconds    DOUBLE PRECISION,
            status              VARCHAR(20) NOT NULL DEFAULT 'running',  -- running | success | failed | skipped
            records_processed   INTEGER,
            notes               TEXT,
            error               TEXT
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_pipeline_runs_worker_finished
            ON pipeline_runs (worker_name, finished_at DESC NULLS LAST)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_pipeline_runs_started
            ON pipeline_runs (started_at DESC)
    """)


def downgrade():
    op.execute("DROP INDEX IF EXISTS idx_pipeline_runs_started")
    op.execute("DROP INDEX IF EXISTS idx_pipeline_runs_worker_finished")
    op.execute("DROP TABLE IF EXISTS pipeline_runs")
