"""023 - olt_registry + engine_reconcile_olt_stats (plug-and-play OLT support)

Revision ID: 023
Revises: 022
Create Date: 2026-05-21

One table holds everything the engine needs to talk to an OLT: host, vendor,
firmware, the SNMP timing knobs, the PON MAC table OID + parsing rules, and
capability flags. Adding OLT #4 = insert one row.

A second table (tall format) tracks per-OLT stats per reconcile run so we
don't depend on fixed columns olt_100/200/210 in engine_reconcile_runs.
"""
from alembic import op


revision = "023"
down_revision = "022"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE IF NOT EXISTS olt_registry (
            host                          VARCHAR(45) PRIMARY KEY,
            name                          VARCHAR(80) NOT NULL,
            vendor                        VARCHAR(40),
            model                         VARCHAR(40),
            firmware                      VARCHAR(40),
            pon_tech                      VARCHAR(10) NOT NULL,           -- epon | gpon
            optical_adapter_profile       VARCHAR(40) NOT NULL,           -- maps host â†’ adapter class (epon_netlink_v203 | gpon_netlink_v23 | gpon_netlink_v14)

            -- PON MAC table walk parameters
            pon_mac_table_oid             VARCHAR(120),
            pon_mac_position_col          INTEGER,
            pon_mac_col                   INTEGER,
            pon_mac_indexed_by_oid        BOOLEAN NOT NULL DEFAULT TRUE,

            -- SNMP transport tuning
            snmp_community                VARCHAR(40) NOT NULL DEFAULT 'public',
            snmp_port                     INTEGER     NOT NULL DEFAULT 162,
            snmp_timeout_sec              INTEGER     NOT NULL DEFAULT 5,
            snmp_chunk                    INTEGER     NOT NULL DEFAULT 50,
            walk_timeout_sec              INTEGER     NOT NULL DEFAULT 90,
            empty_retry                   BOOLEAN     NOT NULL DEFAULT FALSE,

            -- Capability flags (used by NOC truth rules)
            has_lan_mac_table             BOOLEAN     NOT NULL DEFAULT FALSE,
            lan_mac_oid                   VARCHAR(120),
            requires_survey_for_binding   BOOLEAN     NOT NULL DEFAULT FALSE,
            has_customer_bandwidth        BOOLEAN     NOT NULL DEFAULT FALSE,
            has_pon_bandwidth             BOOLEAN     NOT NULL DEFAULT FALSE,
            has_offline_reason            BOOLEAN     NOT NULL DEFAULT FALSE,
            has_traps_verified            BOOLEAN     NOT NULL DEFAULT FALSE,
            customer_bandwidth_reason     TEXT,
            binding_match_note            TEXT,

            -- Lifecycle
            enabled                       BOOLEAN     NOT NULL DEFAULT TRUE,
            notes                         TEXT,
            added_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_olt_registry_enabled
            ON olt_registry (enabled, host)
    """)

    # Per-run, per-OLT stats â€” tall format so adding OLT #4 doesn't need a schema bump.
    op.execute("""
        CREATE TABLE IF NOT EXISTS engine_reconcile_olt_stats (
            run_id          INTEGER NOT NULL REFERENCES engine_reconcile_runs(id) ON DELETE CASCADE,
            olt_host        VARCHAR(45) NOT NULL,
            pon_mac_count   INTEGER,
            optical_count   INTEGER,
            walk_error      TEXT,
            PRIMARY KEY (run_id, olt_host)
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_engine_reconcile_olt_stats_olt
            ON engine_reconcile_olt_stats (olt_host, run_id DESC)
    """)

    # Seed the 3 existing OLTs from olt_capabilities.py + pon_mac_adapter.py + snmp_runner.py.
    op.execute("""
        INSERT INTO olt_registry (
            host, name, vendor, model, firmware, pon_tech, optical_adapter_profile,
            pon_mac_table_oid, pon_mac_position_col, pon_mac_col, pon_mac_indexed_by_oid,
            snmp_community, snmp_port, snmp_timeout_sec, snmp_chunk, walk_timeout_sec, empty_retry,
            has_lan_mac_table, lan_mac_oid, requires_survey_for_binding,
            has_customer_bandwidth, has_pon_bandwidth, has_offline_reason, has_traps_verified,
            customer_bandwidth_reason, binding_match_note, enabled, notes
        ) VALUES
        (
            '10.10.10.100', 'EPON-Booto-Main', 'Netlink', 'V1600D8', 'V2.03.75R',
            'epon', 'epon_netlink_v203',
            '1.3.6.1.4.1.37950.1.1.5.10.3.8.1', 4, 1, TRUE,
            'public', 162, 5, 50, 90, FALSE,
            TRUE, '1.3.6.1.4.1.37950.1.1.5.10.3.8', FALSE,
            TRUE, FALSE, FALSE, TRUE,
            'EPON .100 exposes per-ONU ifTable counters. Values are current OLT traffic counters, not customer speed-test results.',
            'Railwire/account MAC can be exact-matched through the EPON LAN-MAC table.',
            TRUE, 'Seeded from migration 023'
        ),
        (
            '10.10.10.200', 'GPON-Booto-200', 'Netlink', 'V1600G1', 'V2.3.1R',
            'gpon', 'gpon_netlink_v23',
            '1.3.6.1.4.1.37950.1.1.5.10.3.5.1', 5, 3, FALSE,
            'public', 162, 5, 50, 90, FALSE,
            FALSE, NULL, TRUE,
            FALSE, TRUE, FALSE, TRUE,
            'GPON .200 firmware does not expose reliable per-customer bandwidth counters. Use PON aggregate load and Railwire session totals instead.',
            'No SNMP LAN-MAC table exists on this firmware; survey/Admin binding is required.',
            TRUE, 'Seeded from migration 023'
        ),
        (
            '10.10.10.210', 'GPON-Booto-210', 'Netlink', 'V1600G1B', 'V1.4.8R',
            'gpon', 'gpon_netlink_v14',
            '1.3.6.1.4.1.37950.1.1.5.10.3.12.1', 4, 1, TRUE,
            'public', 162, 30, 10, 300, TRUE,
            TRUE, '1.3.6.1.4.1.37950.1.1.5.10.3.12', FALSE,
            FALSE, TRUE, TRUE, FALSE,
            'GPON .210 exposes live optical/state data but not reliable per-customer traffic counters. Do not show customer Mbps from OLT snapshots.',
            'Railwire/account MAC can be exact-matched through the GPON .210 LAN-MAC table; trap target still needs verification.',
            TRUE, 'Seeded from migration 023'
        )
        ON CONFLICT (host) DO NOTHING
    """)


def downgrade():
    op.execute("DROP INDEX IF EXISTS idx_engine_reconcile_olt_stats_olt")
    op.execute("DROP TABLE IF EXISTS engine_reconcile_olt_stats")
    op.execute("DROP INDEX IF EXISTS idx_olt_registry_enabled")
    op.execute("DROP TABLE IF EXISTS olt_registry")
