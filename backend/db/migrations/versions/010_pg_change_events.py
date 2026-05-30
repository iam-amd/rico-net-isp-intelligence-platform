"""010 - PG change history and revert support

Revision ID: 010
Revises: 009
Create Date: 2026-04-29
"""
from alembic import op


revision = "010"
down_revision = "009"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE IF NOT EXISTS pg_change_events (
            id SERIAL PRIMARY KEY,
            entity_type VARCHAR(20) NOT NULL,
            entity_id VARCHAR(36) NOT NULL,
            building_id VARCHAR(36) REFERENCES pg_buildings(id) ON DELETE CASCADE,
            room_id VARCHAR(36) REFERENCES pg_rooms(id) ON DELETE SET NULL,
            action VARCHAR(40) NOT NULL,
            reason TEXT,
            changed_by VARCHAR(80),
            before_data JSONB,
            after_data JSONB,
            created_at TIMESTAMPTZ DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_pg_change_events_entity_type ON pg_change_events(entity_type)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_pg_change_events_entity_id ON pg_change_events(entity_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_pg_change_events_building_id ON pg_change_events(building_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_pg_change_events_room_id ON pg_change_events(room_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_pg_change_events_created_at ON pg_change_events(created_at)")


def downgrade():
    op.execute("DROP INDEX IF EXISTS ix_pg_change_events_created_at")
    op.execute("DROP INDEX IF EXISTS ix_pg_change_events_room_id")
    op.execute("DROP INDEX IF EXISTS ix_pg_change_events_building_id")
    op.execute("DROP INDEX IF EXISTS ix_pg_change_events_entity_id")
    op.execute("DROP INDEX IF EXISTS ix_pg_change_events_entity_type")
    op.execute("DROP TABLE IF EXISTS pg_change_events")
