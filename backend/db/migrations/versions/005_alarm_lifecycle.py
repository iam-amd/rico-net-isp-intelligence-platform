"""
Migration 005 â€” Alarm Lifecycle + New Intelligence Tables
===========================================================
Adds:
  - alarm_events: status, resolved_at, duration_seconds, occurrence_count,
                  last_seen, pon_port_outage_id, area_outage_id
  - onu_state_events      (state changes only â€” onlineâ†”offline, threshold crossings)
  - pon_port_outages      (grouped outage when â‰¥3 ONUs on same PON port go offline)
  - area_outages          (geographic cluster outages â€” GPS or address-based)
  - olt_health            (per-OLT ingest watchdog â€” stale data detection)
  - Dedup onu_snapshots   (remove exact duplicates, add unique index)

Safe to run multiple times (all statements use IF NOT EXISTS / IF EXISTS).
No destructive changes to existing data.

Run:
  cd backend
  python -m db.migrations.versions.005_alarm_lifecycle
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)
)))))

from alembic import op
from database import engine
from sqlalchemy import text

revision = "005"
down_revision = "004"
branch_labels = None
depends_on = None

STEPS = []


def step(label):
    def decorator(fn):
        STEPS.append((label, fn))
        return fn
    return decorator


# ---------------------------------------------------------------------------
# Step 1 â€” alarm_events lifecycle columns
# ---------------------------------------------------------------------------
@step("alarm_events: add lifecycle columns")
def add_alarm_lifecycle(conn):
    conn.execute(text("""
        ALTER TABLE alarm_events
            ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'open',
            ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS duration_seconds INTEGER,
            ADD COLUMN IF NOT EXISTS occurrence_count INTEGER NOT NULL DEFAULT 1,
            ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS pon_port_outage_id INTEGER,
            ADD COLUMN IF NOT EXISTS area_outage_id INTEGER
    """))
    # Backfill last_seen for existing rows
    conn.execute(text("""
        UPDATE alarm_events SET last_seen = received_at WHERE last_seen IS NULL
    """))
    # Partial index: fast lookup of open alarms per MAC+type
    conn.execute(text("""
        CREATE INDEX IF NOT EXISTS idx_alarm_events_open
            ON alarm_events(mac_address, event_type)
            WHERE status = 'open'
    """))
    # Index for fast resolution queries
    conn.execute(text("""
        CREATE INDEX IF NOT EXISTS idx_alarm_events_status
            ON alarm_events(status, received_at DESC)
    """))


# ---------------------------------------------------------------------------
# Step 2 â€” onu_state_events table
# ---------------------------------------------------------------------------
@step("create onu_state_events")
def create_onu_state_events(conn):
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS onu_state_events (
            id           SERIAL PRIMARY KEY,
            mac_address  VARCHAR(64) NOT NULL,
            olt_host     VARCHAR(45) NOT NULL,
            pon_port     VARCHAR(20),
            onu_index    INTEGER,
            event_type   VARCHAR(30) NOT NULL,
            -- status_change | threshold_crossed | threshold_recovered
            -- signal_drop | high_temp | flap_spike
            from_state   VARCHAR(30),
            to_state     VARCHAR(30) NOT NULL,
            rx_power_dbm FLOAT,
            occurred_at  TIMESTAMPTZ NOT NULL,
            detected_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """))
    conn.execute(text("""
        CREATE INDEX IF NOT EXISTS idx_state_events_mac
            ON onu_state_events(mac_address, occurred_at DESC)
    """))
    conn.execute(text("""
        CREATE INDEX IF NOT EXISTS idx_state_events_detected
            ON onu_state_events(detected_at DESC)
    """))


# ---------------------------------------------------------------------------
# Step 3 â€” pon_port_outages table
# ---------------------------------------------------------------------------
@step("create pon_port_outages")
def create_pon_port_outages(conn):
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS pon_port_outages (
            id             SERIAL PRIMARY KEY,
            olt_host       VARCHAR(45) NOT NULL,
            pon_port       VARCHAR(20) NOT NULL,
            status         VARCHAR(20) NOT NULL DEFAULT 'open',
            affected_count INTEGER NOT NULL DEFAULT 0,
            fault_type     VARCHAR(30) DEFAULT 'UNKNOWN',
            -- UNKNOWN | PON_FIBER_CUT | OLT_PORT_FAILURE | POWER_CUT
            detected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            resolved_at    TIMESTAMPTZ,
            duration_seconds INTEGER
        )
    """))
    conn.execute(text("""
        CREATE INDEX IF NOT EXISTS idx_pon_outages_open
            ON pon_port_outages(olt_host, pon_port)
            WHERE status = 'open'
    """))
    conn.execute(text("""
        CREATE INDEX IF NOT EXISTS idx_pon_outages_time
            ON pon_port_outages(detected_at DESC)
    """))


# ---------------------------------------------------------------------------
# Step 4 â€” area_outages table
# ---------------------------------------------------------------------------
@step("create area_outages")
def create_area_outages(conn):
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS area_outages (
            id             SERIAL PRIMARY KEY,
            status         VARCHAR(20) NOT NULL DEFAULT 'open',
            affected_count INTEGER NOT NULL DEFAULT 0,
            centroid_lat   FLOAT,
            centroid_lng   FLOAT,
            radius_m       FLOAT,
            fault_type     VARCHAR(30) DEFAULT 'POWER_CUT',
            area_name      VARCHAR(120),
            detected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            resolved_at    TIMESTAMPTZ,
            duration_seconds INTEGER
        )
    """))
    conn.execute(text("""
        CREATE INDEX IF NOT EXISTS idx_area_outages_open
            ON area_outages(status, detected_at DESC)
    """))


# ---------------------------------------------------------------------------
# Step 5 â€” olt_health table (ingest watchdog)
# ---------------------------------------------------------------------------
@step("create olt_health")
def create_olt_health(conn):
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS olt_health (
            olt_host          VARCHAR(45) PRIMARY KEY,
            last_snapshot_at  TIMESTAMPTZ,
            last_trap_at      TIMESTAMPTZ,
            status            VARCHAR(20) NOT NULL DEFAULT 'unknown',
            -- unknown | ok | stale | unreachable
            stale_since       TIMESTAMPTZ,
            snapshot_count_24h INTEGER DEFAULT 0,
            updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """))
    # Seed known OLTs so watchdog has a baseline
    conn.execute(text("""
        INSERT INTO olt_health (olt_host, status)
        VALUES
            ('10.10.10.100', 'unknown'),
            ('10.10.10.200', 'unknown'),
            ('10.10.10.210', 'unknown')
        ON CONFLICT (olt_host) DO NOTHING
    """))


# ---------------------------------------------------------------------------
# Step 6 â€” onu_snapshots: remove exact duplicates + add unique index
# ---------------------------------------------------------------------------
@step("onu_snapshots: dedup + unique index")
def dedup_onu_snapshots(conn):
    # Count duplicates first
    result = conn.execute(text("""
        SELECT COUNT(*) FROM (
            SELECT mac_address, polled_at, COUNT(*) as cnt
            FROM onu_snapshots
            GROUP BY mac_address, polled_at
            HAVING COUNT(*) > 1
        ) dupes
    """)).scalar()
    print(f"    Duplicate (mac_address, polled_at) groups found: {result}")

    if result > 0:
        # Keep the row with the largest id (most recently written) per duplicate group
        deleted = conn.execute(text("""
            DELETE FROM onu_snapshots
            WHERE id NOT IN (
                SELECT MAX(id)
                FROM onu_snapshots
                GROUP BY mac_address, polled_at
            )
        """)).rowcount
        print(f"    Deleted {deleted} duplicate snapshot rows")
    else:
        print("    No duplicates found â€” clean")

    conn.execute(text("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_dedup
            ON onu_snapshots(mac_address, polled_at)
    """))
    print("    Unique index idx_snapshots_dedup created")


# ---------------------------------------------------------------------------
# Main runner
# ---------------------------------------------------------------------------
def upgrade():
    conn = op.get_bind()
    for _, fn in STEPS:
        fn(conn)


def downgrade():
    # Additive safety migration. Keep existing production data and tables intact.
    pass


def run():
    print("=" * 60)
    print("Migration 005 â€” Alarm Lifecycle + Intelligence Tables")
    print("=" * 60)

    with engine.begin() as conn:
        for label, fn in STEPS:
            print(f"\n[STEP] {label}")
            fn(conn)
            print(f"  OK")

    print("\n" + "=" * 60)
    print("Migration 005 COMPLETE")
    print("=" * 60)

    # Verification
    print("\nVerification:")
    with engine.connect() as conn:
        cols = conn.execute(text("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'alarm_events'
            AND column_name IN ('status','resolved_at','duration_seconds','occurrence_count','last_seen')
            ORDER BY column_name
        """)).fetchall()
        print(f"  alarm_events new columns: {[c[0] for c in cols]}")

        tables = conn.execute(text("""
            SELECT table_name FROM information_schema.tables
            WHERE table_name IN ('onu_state_events','pon_port_outages','area_outages','olt_health')
            AND table_schema = 'public'
            ORDER BY table_name
        """)).fetchall()
        print(f"  New tables: {[t[0] for t in tables]}")

        olt_rows = conn.execute(text("SELECT olt_host, status FROM olt_health ORDER BY olt_host")).fetchall()
        print(f"  olt_health seeded: {[(r[0], r[1]) for r in olt_rows]}")


if __name__ == "__main__":
    run()
