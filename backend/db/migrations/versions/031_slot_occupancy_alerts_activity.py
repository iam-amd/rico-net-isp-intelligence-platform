"""031 - slot_occupancy_history + binding_alerts + activity_events

Revision ID: 031
Revises: 030
Create Date: 2026-05-24

Three new tables that close the silent-binding-drift gap:

  * slot_occupancy_history — one row per (olt, port, index, mac) ever observed.
    Closes when a new MAC takes the slot (vacated_at filled). Lets the engine
    detect "the device at slot X changed identity" within one reconcile cycle
    instead of waiting for a human to update Railwire.

  * binding_alerts — actionable inbox row per drift/anomaly event. Severity
    drives UI colour. Each carries a suggested_action so the operator gets a
    one-click resolution instead of having to investigate from scratch.

  * activity_events — unified, append-only log of EVERY notable thing the
    pipeline does (new customer detected, MAC scraped, position changed,
    device swap detected, alert raised, ...). Powers the "Activity" feed on
    /pipeline and gives the operator a complete audit trail.
"""
from alembic import op


revision = "031"
down_revision = "030"
branch_labels = None
depends_on = None


def upgrade():
    # --- slot_occupancy_history ---------------------------------------------
    op.execute("""
        CREATE TABLE IF NOT EXISTS slot_occupancy_history (
            id              BIGSERIAL PRIMARY KEY,
            olt_host        VARCHAR(64) NOT NULL,
            pon_port        VARCHAR(32) NOT NULL,
            onu_index       INTEGER NOT NULL,
            optical_mac     VARCHAR(32) NOT NULL,
            first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            vacated_at      TIMESTAMPTZ,
            sample_count    INTEGER NOT NULL DEFAULT 1
        )
    """)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_slot_occupancy_slot_mac
            ON slot_occupancy_history (olt_host, pon_port, onu_index, optical_mac)
    """)
    # Fast lookup: who currently occupies this slot?
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_slot_occupancy_current
            ON slot_occupancy_history (olt_host, pon_port, onu_index)
            WHERE vacated_at IS NULL
    """)
    # Reverse lookup: where has this MAC ever lived?
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_slot_occupancy_mac
            ON slot_occupancy_history (optical_mac)
    """)

    # --- binding_alerts -----------------------------------------------------
    op.execute("""
        CREATE TABLE IF NOT EXISTS binding_alerts (
            id                  BIGSERIAL PRIMARY KEY,
            category            VARCHAR(60) NOT NULL,
            severity            VARCHAR(16) NOT NULL DEFAULT 'warning',
            summary             TEXT NOT NULL,
            suggested_action    TEXT,
            customer_username   VARCHAR(128),
            olt_host            VARCHAR(64),
            pon_port            VARCHAR(32),
            onu_index           INTEGER,
            current_state       JSONB,
            dedup_key           VARCHAR(255),
            status              VARCHAR(16) NOT NULL DEFAULT 'open',
            opened_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            resolved_at         TIMESTAMPTZ,
            resolved_by         VARCHAR(128),
            resolution_note     TEXT
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_binding_alerts_status_opened
            ON binding_alerts (status, opened_at DESC)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_binding_alerts_customer
            ON binding_alerts (customer_username)
    """)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_binding_alerts_dedup_open
            ON binding_alerts (dedup_key)
            WHERE status = 'open' AND dedup_key IS NOT NULL
    """)

    # --- activity_events ----------------------------------------------------
    op.execute("""
        CREATE TABLE IF NOT EXISTS activity_events (
            id                  BIGSERIAL PRIMARY KEY,
            ts                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            category            VARCHAR(40) NOT NULL,
            severity            VARCHAR(16) NOT NULL DEFAULT 'info',
            actor               VARCHAR(80),
            customer_username   VARCHAR(128),
            summary             TEXT NOT NULL,
            payload             JSONB
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_activity_events_ts
            ON activity_events (ts DESC)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_activity_events_category_ts
            ON activity_events (category, ts DESC)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_activity_events_customer_ts
            ON activity_events (customer_username, ts DESC)
            WHERE customer_username IS NOT NULL
    """)


def downgrade():
    op.execute("DROP INDEX IF EXISTS idx_activity_events_customer_ts")
    op.execute("DROP INDEX IF EXISTS idx_activity_events_category_ts")
    op.execute("DROP INDEX IF EXISTS idx_activity_events_ts")
    op.execute("DROP TABLE IF EXISTS activity_events")

    op.execute("DROP INDEX IF EXISTS idx_binding_alerts_dedup_open")
    op.execute("DROP INDEX IF EXISTS idx_binding_alerts_customer")
    op.execute("DROP INDEX IF EXISTS idx_binding_alerts_status_opened")
    op.execute("DROP TABLE IF EXISTS binding_alerts")

    op.execute("DROP INDEX IF EXISTS idx_slot_occupancy_mac")
    op.execute("DROP INDEX IF EXISTS idx_slot_occupancy_current")
    op.execute("DROP INDEX IF EXISTS idx_slot_occupancy_slot_mac")
    op.execute("DROP TABLE IF EXISTS slot_occupancy_history")
