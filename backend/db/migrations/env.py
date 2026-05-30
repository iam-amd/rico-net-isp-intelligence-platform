"""
Alembic environment configuration for Rico Net.

This file is executed by Alembic every time a migration command runs.
It reads DATABASE_URL from config/settings.py (which loads .env) and
imports all SQLAlchemy models so that autogenerate can detect changes.
"""
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool

from alembic import context

# ---------------------------------------------------------------------------
# 1. Import project settings & models
#    Because alembic.ini sets `prepend_sys_path = .` (the backend/ dir),
#    bare imports like "from database import Base" work here.
# ---------------------------------------------------------------------------
from config.settings import settings  # single source of truth for DATABASE_URL
from database import Base

# Import models so they register with Base.metadata before autogenerate runs.
# If you add a new model file, import it here too.
import models  # noqa: F401  — side-effect import

# ---------------------------------------------------------------------------
# 2. Alembic Config object — gives access to values in alembic.ini
# ---------------------------------------------------------------------------
config = context.config

# Override sqlalchemy.url from our Settings (never hardcode it in alembic.ini)
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)

# Set up Python logging from the ini file
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# The metadata object that Alembic uses for autogenerate comparisons
target_metadata = Base.metadata

# ---------------------------------------------------------------------------
# 3. Migration runners
# ---------------------------------------------------------------------------


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This generates SQL scripts without connecting to the database.
    Useful for reviewing migrations or applying them via a DBA.
    """
    url = settings.DATABASE_URL
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    Creates an Engine and associates a connection with the context.
    """
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
