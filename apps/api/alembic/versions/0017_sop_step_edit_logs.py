"""Add sop_step_edit_logs for reviewer step edits (H09AAPPLE-57).

Revision ID: 0017_sop_step_edit_logs
Revises: 0016_friction_analysis
Create Date: 2026-08-03
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0017_sop_step_edit_logs"
down_revision = "0016_friction_analysis"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sop_step_edit_logs",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "sop_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sops.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("step_number", sa.Integer(), nullable=False),
        sa.Column(
            "editor_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("before_text", sa.Text(), nullable=False),
        sa.Column("after_text", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint("step_number >= 1", name="ck_sop_step_edit_logs_step_number_pos"),
    )
    op.create_index("ix_sop_step_edit_logs_tenant_id", "sop_step_edit_logs", ["tenant_id"])
    op.create_index("ix_sop_step_edit_logs_sop_id", "sop_step_edit_logs", ["sop_id"])
    op.create_index("ix_sop_step_edit_logs_editor_id", "sop_step_edit_logs", ["editor_id"])
    op.create_index(
        "ix_sop_step_edit_logs_sop_created",
        "sop_step_edit_logs",
        ["sop_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_sop_step_edit_logs_sop_created", table_name="sop_step_edit_logs")
    op.drop_index("ix_sop_step_edit_logs_editor_id", table_name="sop_step_edit_logs")
    op.drop_index("ix_sop_step_edit_logs_sop_id", table_name="sop_step_edit_logs")
    op.drop_index("ix_sop_step_edit_logs_tenant_id", table_name="sop_step_edit_logs")
    op.drop_table("sop_step_edit_logs")
