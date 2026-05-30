"""014 - alarm_events foreign keys + hot-path indexes

Revision ID: 014
Revises: 013
Create Date: 2026-05-10

Adds the missing FK constraints on alarm_events and a handful of
composite indexes that hot-path queries (recent alarms, audit log,
binding lookup) currently full-scan.

Safe to re-run: every statement uses IF (NOT) EXISTS / DO blocks.
Orphaned FK rows are nulled first so the constraint can attach.
"""
from alembic import op


revision = "014"
down_revision = "013"
branch_labels = None
depends_on = None


def upgrade():
    # ---- alarm_events.pon_port_outage_id -> pon_port_outages.id -----------
    # Null out any rows that reference a non-existent outage so the FK can
    # attach without violation. ON DELETE SET NULL keeps alarm history
    # intact when an outage row is later removed.
    op.execute("""
        UPDATE alarm_events ae
           SET pon_port_outage_id = NULL
         WHERE ae.pon_port_outage_id IS NOT NULL
           AND NOT EXISTS (
               SELECT 1 FROM pon_port_outages p
                WHERE p.id = ae.pon_port_outage_id
           )
    """)
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints
                 WHERE table_name = 'alarm_events'
                   AND constraint_name = 'fk_alarm_events_pon_port_outage'
            ) THEN
                ALTER TABLE alarm_events
                  ADD CONSTRAINT fk_alarm_events_pon_port_outage
                  FOREIGN KEY (pon_port_outage_id)
                  REFERENCES pon_port_outages(id)
                  ON DELETE SET NULL;
            END IF;
        END $$;
    """)

    # ---- alarm_events.area_outage_id -> area_outages.id -------------------
    op.execute("""
        UPDATE alarm_events ae
           SET area_outage_id = NULL
         WHERE ae.area_outage_id IS NOT NULL
           AND NOT EXISTS (
               SELECT 1 FROM area_outages a
                WHERE a.id = ae.area_outage_id
           )
    """)
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints
                 WHERE table_name = 'alarm_events'
                   AND constraint_name = 'fk_alarm_events_area_outage'
            ) THEN
                ALTER TABLE alarm_events
                  ADD CONSTRAINT fk_alarm_events_area_outage
                  FOREIGN KEY (area_outage_id)
                  REFERENCES area_outages(id)
                  ON DELETE SET NULL;
            END IF;
        END $$;
    """)

    # ---- Hot-path indexes -------------------------------------------------
    # 1. ticket_audit_log: "show recent activity" pages order by changed_at DESC
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_ticket_audit_log_changed_at
            ON ticket_audit_log (changed_at DESC)
    """)

    # 2. alarm_events: NOC dashboard "open alarms by recency" query.
    #    Composite (status, received_at DESC) lets PG scan only the open
    #    partition and return them already sorted.
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_alarm_events_status_received_at
            ON alarm_events (status, received_at DESC)
    """)

    # 3. onu_bindings: every "find ONU for customer" lookup filters
    #    customer_id + is_active and projects onu_identifier. Composite
    #    matches the access path exactly.
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_onu_bindings_customer_active_identifier
            ON onu_bindings (customer_id, is_active, onu_identifier)
    """)


def downgrade():
    op.execute("DROP INDEX IF EXISTS idx_onu_bindings_customer_active_identifier")
    op.execute("DROP INDEX IF EXISTS idx_alarm_events_status_received_at")
    op.execute("DROP INDEX IF EXISTS idx_ticket_audit_log_changed_at")
    op.execute("ALTER TABLE alarm_events DROP CONSTRAINT IF EXISTS fk_alarm_events_area_outage")
    op.execute("ALTER TABLE alarm_events DROP CONSTRAINT IF EXISTS fk_alarm_events_pon_port_outage")
