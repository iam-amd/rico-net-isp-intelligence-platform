"""baseline: current ORM schema

Revision ID: 001
Revises: None
Create Date: 2026-03-25

This migration used to be a no-op marker for a database created by
SQLAlchemy's Base.metadata.create_all(). Production now treats Alembic as the
schema authority. On a fresh database, this baseline creates the ORM-defined
tables through Alembic's connection; historical follow-up migrations stay
idempotent so existing deployments can continue forward.
"""
from typing import Sequence, Union

from alembic import op


revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    from database import Base
    import models  # noqa: F401  # registers ORM tables with Base.metadata

    Base.metadata.create_all(bind=op.get_bind())


def downgrade() -> None:
    # Never drop production tables from the baseline migration.
    pass
