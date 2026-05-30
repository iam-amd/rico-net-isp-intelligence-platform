"""006 — PG Buildings / Floors / Rooms / Router Groups

Revision ID: 006
Revises: 005
Create Date: 2026-04-26
"""
from alembic import op

revision = '006'
down_revision = '005'
branch_labels = None
depends_on = None


def upgrade():
    # Idempotent because existing deployments may already have these tables from
    # create_all/startup migrations before Alembic was repaired.
    op.execute("""
        CREATE TABLE IF NOT EXISTS pg_buildings (
            id VARCHAR(36) PRIMARY KEY,
            name VARCHAR(200) NOT NULL,
            pg_type VARCHAR(20) NOT NULL DEFAULT 'Mixed',
            address TEXT,
            owner_name VARCHAR(120) NOT NULL,
            owner_mobile VARCHAR(20),
            owner_alt_mobile VARCHAR(20),
            gps_lat FLOAT,
            gps_lng FLOAT,
            photo_url VARCHAR(500),
            created_by VARCHAR(50),
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ
        )
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS pg_floors (
            id VARCHAR(36) PRIMARY KEY,
            building_id VARCHAR(36) NOT NULL REFERENCES pg_buildings(id) ON DELETE CASCADE,
            floor_number INTEGER NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS pg_router_groups (
            id VARCHAR(36) PRIMARY KEY,
            building_id VARCHAR(36) NOT NULL REFERENCES pg_buildings(id) ON DELETE CASCADE,
            floor_id VARCHAR(36) NOT NULL REFERENCES pg_floors(id) ON DELETE CASCADE,
            group_name VARCHAR(100) NOT NULL,
            ont_serial VARCHAR(64),
            mac_address VARCHAR(17),
            username VARCHAR(50),
            photo_url VARCHAR(500),
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ
        )
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS pg_rooms (
            id VARCHAR(36) PRIMARY KEY,
            building_id VARCHAR(36) NOT NULL REFERENCES pg_buildings(id) ON DELETE CASCADE,
            floor_id VARCHAR(36) NOT NULL REFERENCES pg_floors(id) ON DELETE CASCADE,
            router_group_id VARCHAR(36) REFERENCES pg_router_groups(id) ON DELETE SET NULL,
            room_number VARCHAR(20) NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            connection_type VARCHAR(20) NOT NULL DEFAULT 'none',
            username VARCHAR(50),
            ont_serial VARCHAR(64),
            mac_address VARCHAR(17),
            ont_model VARCHAR(64),
            tech_note TEXT,
            photo_urls TEXT,
            collected_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_pg_floors_building_id ON pg_floors(building_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_pg_router_groups_building_id ON pg_router_groups(building_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_pg_router_groups_floor_id ON pg_router_groups(floor_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_pg_rooms_building_id ON pg_rooms(building_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_pg_rooms_floor_id ON pg_rooms(floor_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_pg_rooms_router_group_id ON pg_rooms(router_group_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_pg_rooms_building_floor ON pg_rooms(building_id, floor_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_pg_floors_building ON pg_floors(building_id, floor_number)")


def downgrade():
    op.drop_table('pg_rooms')
    op.drop_table('pg_router_groups')
    op.drop_table('pg_floors')
    op.drop_table('pg_buildings')
