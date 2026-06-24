"""Add codification jobs table for session ingestion.

Revision ID: 0002_codification_jobs
Revises: 0001_init
Create Date: 2026-06-24
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0002_codification_jobs"
down_revision = "0001_init"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "codification_jobs",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column(
            "session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.String(length=32),
            nullable=False,
            server_default="pending",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "status IN ('pending','processing','completed','failed')",
            name="ck_codification_jobs_status",
        ),
    )
    op.create_index(
        "ix_codification_jobs_session_id",
        "codification_jobs",
        ["session_id"],
    )
    op.create_index(
        "ix_codification_jobs_status_created",
        "codification_jobs",
        ["status", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_codification_jobs_status_created", table_name="codification_jobs")
    op.drop_index("ix_codification_jobs_session_id", table_name="codification_jobs")
    op.drop_table("codification_jobs")
