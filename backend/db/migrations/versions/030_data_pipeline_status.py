"""030 - data_pipeline_status + last_diagnosis on customer_dna

Revision ID: 030
Revises: 029
Create Date: 2026-05-22

Categorical pipeline state per customer (10 states, see classify_customers).
Together with last_diagnosis (free text), this lets the /pipeline page show
a stacked breakdown of WHERE in the pipeline each customer is stuck —
instead of one bucket called "missing MAC".
"""
from alembic import op


revision = "030"
down_revision = "029"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        ALTER TABLE customer_dna
        ADD COLUMN IF NOT EXISTS data_pipeline_status VARCHAR(40),
        ADD COLUMN IF NOT EXISTS last_diagnosis       TEXT,
        ADD COLUMN IF NOT EXISTS classified_at        TIMESTAMPTZ
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_customer_dna_pipeline_status
            ON customer_dna (data_pipeline_status)
    """)


def downgrade():
    op.execute("DROP INDEX IF EXISTS idx_customer_dna_pipeline_status")
    op.execute("ALTER TABLE customer_dna DROP COLUMN IF EXISTS classified_at")
    op.execute("ALTER TABLE customer_dna DROP COLUMN IF EXISTS last_diagnosis")
    op.execute("ALTER TABLE customer_dna DROP COLUMN IF EXISTS data_pipeline_status")
