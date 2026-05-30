"""028 - pipeline_user_actions (clicks from /pipeline page)

Revision ID: 028
Revises: 027
Create Date: 2026-05-22

Every Bind / Re-scrape / Scrape-account click from the /pipeline page lands
here so the Run History on the page shows what the operator actually did,
not just scheduler-driven scraper runs. Two-phase log: a 'start' row is
written when the action begins, then the same row is updated with the final
status + result_summary.
"""
from alembic import op


revision = "028"
down_revision = "027"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE IF NOT EXISTS pipeline_user_actions (
            id              BIGSERIAL PRIMARY KEY,
            action          VARCHAR(40)  NOT NULL,        -- bind | rescrape | scrape_account | engine_reconcile
            customer        VARCHAR,                       -- nullable for account-wide actions
            account         VARCHAR(80),                   -- railwire_admin or null = both
            step            VARCHAR(20),                   -- csv | mac | details | all | single | bind
            triggered_by    VARCHAR(80) NOT NULL,          -- technicians.username
            started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            finished_at     TIMESTAMPTZ,
            duration_ms     INTEGER,
            status          VARCHAR(20)  NOT NULL DEFAULT 'start',  -- start | ok | error | miss
            result_summary  TEXT,
            error_message   TEXT,
            pid             INTEGER                        -- subprocess pid for scraper triggers
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_pua_started ON pipeline_user_actions (started_at DESC)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_pua_account ON pipeline_user_actions (account, started_at DESC)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_pua_customer ON pipeline_user_actions (customer, started_at DESC)")


def downgrade():
    op.execute("DROP INDEX IF EXISTS idx_pua_customer")
    op.execute("DROP INDEX IF EXISTS idx_pua_account")
    op.execute("DROP INDEX IF EXISTS idx_pua_started")
    op.execute("DROP TABLE IF EXISTS pipeline_user_actions")
