"""Add per-step SOP embeddings with pgvector (H09AAPPLE-34).

Revision ID: 0008_sop_step_embedding
Revises: 0007_consent_acceptance
Create Date: 2026-07-12
"""

from __future__ import annotations

import sqlalchemy as sa
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0008_sop_step_embedding"
down_revision = "0007_consent_acceptance"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.create_table(
        "sop_step_embedding",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("sop_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("step_number", sa.Integer(), nullable=False),
        sa.Column("embedding", Vector(1536), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["sop_id"], ["sops.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("sop_id", "step_number", name="uq_sop_step_embedding_sop_step"),
        sa.CheckConstraint("step_number >= 1", name="ck_sop_step_embedding_step_number_pos"),
    )
    op.create_index(
        "ix_sop_step_embedding_sop_id",
        "sop_step_embedding",
        ["sop_id"],
    )
    # lists=10 is sized for <1000 rows. Downstream similarity queries should fall
    # back to seqscan when row count < lists (IVFFlat can return 0 rows otherwise).
    op.execute(
        """
        CREATE INDEX ix_sop_step_embedding_embedding_ivfflat
            ON sop_step_embedding
            USING ivfflat (embedding vector_cosine_ops)
            WITH (lists = 10)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_sop_step_embedding_embedding_ivfflat")
    op.drop_index("ix_sop_step_embedding_sop_id", table_name="sop_step_embedding")
    op.drop_table("sop_step_embedding")
