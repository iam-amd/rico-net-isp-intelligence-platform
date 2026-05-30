"""
Startup migration tasks — extracted from main.py.
These run on app startup to ensure schema compatibility with older databases.
"""
import logging

from sqlalchemy import inspect, text

import models
from config.settings import settings
from database import SessionLocal, engine

logger = logging.getLogger("rico_net.migrations")


def ensure_customer_columns():
    """Ensure the customers table has id, connection_status, last_seen_online columns."""
    try:
        db = SessionLocal()
        inspector = inspect(engine)
        columns = [c["name"] for c in inspector.get_columns("customers")]

        if "id" not in columns:
            logger.info("Adding 'id' column to customers table...")
            db.execute(text("CREATE SEQUENCE IF NOT EXISTS customers_id_seq"))
            db.execute(text(
                "ALTER TABLE customers ADD COLUMN id INTEGER UNIQUE "
                "NOT NULL DEFAULT nextval('customers_id_seq')"
            ))
            db.commit()
            logger.info("Successfully added 'id' column to customers table")

        if "connection_status" not in columns:
            logger.info("Adding 'connection_status' column to customers table...")
            db.execute(text(
                "ALTER TABLE customers ADD COLUMN connection_status VARCHAR(20) "
                "NOT NULL DEFAULT 'unknown'"
            ))
            db.commit()
            logger.info("Successfully added 'connection_status' column")

        if "last_seen_online" not in columns:
            logger.info("Adding 'last_seen_online' column to customers table...")
            db.execute(text(
                "ALTER TABLE customers ADD COLUMN last_seen_online TIMESTAMPTZ"
            ))
            db.commit()
            logger.info("Successfully added 'last_seen_online' column")

        # WiFi 5GHz band column
        if "wifi_ssid_5g" not in columns:
            logger.info("Adding 'wifi_ssid_5g' column to customers table...")
            db.execute(text("ALTER TABLE customers ADD COLUMN wifi_ssid_5g VARCHAR(100)"))
            db.commit()

        # Field survey columns (Operation Bridge the Gap)
        survey_cols = {
            "gps_lat": "DOUBLE PRECISION",
            "gps_lng": "DOUBLE PRECISION",
            "gps_accuracy_m": "DOUBLE PRECISION",
            "alt_phone": "VARCHAR(20)",
            "install_photo_url": "VARCHAR",
            "last_surveyed_at": "TIMESTAMPTZ",
        }
        for col_name, col_type in survey_cols.items():
            if col_name not in columns:
                logger.info("Adding '%s' column to customers table...", col_name)
                db.execute(text(f"ALTER TABLE customers ADD COLUMN {col_name} {col_type}"))
                db.commit()

        # Pole Group FK on customers — depends on pole_groups table existing
        # (create_all runs before this, so the table is already there)
        if "pg_id" not in columns:
            logger.info("Adding 'pg_id' column + FK to customers table...")
            db.execute(text(
                "ALTER TABLE customers ADD COLUMN pg_id INTEGER "
                "REFERENCES pole_groups(id) ON DELETE SET NULL"
            ))
            db.execute(text("CREATE INDEX IF NOT EXISTS ix_customers_pg_id ON customers(pg_id)"))
            db.commit()

        db.close()
    except Exception as e:
        logger.error("Error ensuring customer columns: %s", str(e))


def migrate_ticket_media_paths():
    """Convert full filesystem paths in ticket_media to relative /uploads/ URLs."""
    try:
        db = SessionLocal()
        rows = db.query(models.TicketMedia).filter(
            ~models.TicketMedia.file_path.startswith("/uploads/")
        ).all()
        fixed = 0
        for media in rows:
            path = media.file_path
            idx = path.replace("\\", "/").find("/uploads/")
            if idx != -1:
                media.file_path = path.replace("\\", "/")[idx:]
                fixed += 1
            else:
                logger.warning("Could not migrate media path: %s (id=%d)", path, media.id)
        if fixed:
            db.commit()
            logger.info("Migrated %d ticket_media rows from full paths to relative URLs", fixed)
        else:
            logger.info("No ticket_media rows needed path migration")
        db.close()
    except Exception as e:
        logger.error("Error during ticket_media path migration: %s", str(e))


def ensure_pg_room_columns():
    """Ensure pg_rooms has WiFi + scan_history columns added 2026-04-27."""
    try:
        db = SessionLocal()
        inspector = inspect(engine)
        if "pg_rooms" not in inspector.get_table_names():
            db.close()
            return
        columns = [c["name"] for c in inspector.get_columns("pg_rooms")]
        new_cols = {
            "wifi_ssid":    "VARCHAR(100)",
            "wifi_ssid_5g": "VARCHAR(100)",
            "wifi_password": "VARCHAR(100)",
            "scan_history": "TEXT",
        }
        for col_name, col_type in new_cols.items():
            if col_name not in columns:
                logger.info("Adding '%s' to pg_rooms...", col_name)
                db.execute(text(f"ALTER TABLE pg_rooms ADD COLUMN {col_name} {col_type}"))
                db.commit()
        # Widen mac_address from VARCHAR(17) to VARCHAR(32) for GPON serials
        col_info = {c["name"]: c for c in inspector.get_columns("pg_rooms")}
        if "mac_address" in col_info:
            raw_type = str(col_info["mac_address"]["type"])
            if "17" in raw_type:
                db.execute(text("ALTER TABLE pg_rooms ALTER COLUMN mac_address TYPE VARCHAR(32)"))
                db.commit()
                logger.info("Widened pg_rooms.mac_address to VARCHAR(32)")
        db.close()
    except Exception as e:
        logger.error("Error ensuring pg_room columns: %s", e)


def normalize_onu_pon_ports():
    """
    One-time fix: normalize pon_port from SNMP short format ("1","2") to
    Telnet format ("0/1","0/2") in onu_latest and onu_snapshots.

    SNMP snmp_client.py was storing port_num as str(port_num) e.g. "1".
    Telnet stores "0/1". This caused duplicate port entries in the NOC dashboard.
    After snmp_client.py fix (2026-05-02) new data comes in as "0/1", but
    existing DB rows need one-time cleanup.
    """
    try:
        db = SessionLocal()
        # Fix onu_latest: rows where pon_port is a bare integer string (no slash)
        result = db.execute(text("""
            UPDATE onu_latest
            SET pon_port = '0/' || pon_port
            WHERE pon_port ~ '^[0-9]{1,2}$'
        """))
        if result.rowcount:
            logger.info("normalize_onu_pon_ports: fixed %d onu_latest rows", result.rowcount)

        # Fix onu_snapshots: same cleanup for historical data
        result2 = db.execute(text("""
            UPDATE onu_snapshots
            SET pon_port = '0/' || pon_port
            WHERE pon_port ~ '^[0-9]{1,2}$'
        """))
        if result2.rowcount:
            logger.info("normalize_onu_pon_ports: fixed %d onu_snapshots rows", result2.rowcount)

        db.commit()
        db.close()
    except Exception as e:
        logger.error("normalize_onu_pon_ports failed: %s", e)


def register_startup_events(app):
    """Register all startup migration tasks on the FastAPI app."""

    @app.on_event("startup")
    def _on_startup():
        if settings.RUN_STARTUP_SCHEMA_REPAIR:
            logger.warning(
                "RUN_STARTUP_SCHEMA_REPAIR is enabled. This is a legacy repair "
                "mode; normal deployments must run Alembic migrations instead."
            )
            ensure_customer_columns()
            ensure_pg_room_columns()
        else:
            logger.info("Skipping startup schema repair; schema is managed by Alembic.")

        if settings.RUN_STARTUP_DATA_MAINTENANCE:
            logger.info("Running startup data maintenance...")
            migrate_ticket_media_paths()
            normalize_onu_pon_ports()
            logger.info("Startup data maintenance complete.")
        else:
            logger.info("Startup data maintenance disabled.")
