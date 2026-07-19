"""Add SOP embedding_status and embed job columns (H09AAPPLE-35).

Revision ID: 0011_sop_embed_status
Revises: 0010_auth_token_tables
Create Date: 2026-07-16
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0011_sop_embed_status"
down_revision = "0010_auth_token_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "sops",
        sa.Column("embedding_status", sa.String(length=32), nullable=True),
    )
    op.create_check_constraint(
        "ck_sops_embedding_status",
        "sops",
        "embedding_status IS NULL OR embedding_status IN ('pending','complete','failed')",
    )

    op.add_column(
        "codification_jobs",
        sa.Column(
            "job_type",
            sa.String(length=32),
            nullable=False,
            server_default="generate",
        ),
    )
    op.add_column(
        "codification_jobs",
        sa.Column("sop_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_codification_jobs_sop_id",
        "codification_jobs",
        "sops",
        ["sop_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_check_constraint(
        "ck_codification_jobs_job_type",
        "codification_jobs",
        "job_type IN ('generate','embed')",
    )
    op.create_index("ix_codification_jobs_sop_id", "codification_jobs", ["sop_id"])
    op.create_index("ix_codification_jobs_job_type", "codification_jobs", ["job_type"])


def downgrade() -> None:
    op.drop_index("ix_codification_jobs_job_type", table_name="codification_jobs")
    op.drop_index("ix_codification_jobs_sop_id", table_name="codification_jobs")
    op.drop_constraint("ck_codification_jobs_job_type", "codification_jobs", type_="check")
    op.drop_constraint("fk_codification_jobs_sop_id", "codification_jobs", type_="foreignkey")
    op.drop_column("codification_jobs", "sop_id")
    op.drop_column("codification_jobs", "job_type")
    op.drop_constraint("ck_sops_embedding_status", "sops", type_="check")
    op.drop_column("sops", "embedding_status")
