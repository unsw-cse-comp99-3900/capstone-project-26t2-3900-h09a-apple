"""Add walkthrough completion tracking (H09AAPPLE-30).

Revision ID: 0009_walkthrough_completion
Revises: 0008_sop_step_embedding
Create Date: 2026-07-15
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0009_walkthrough_completion"
down_revision = "0008_sop_step_embedding"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "walkthrough_completions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "sop_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "employee_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "completed_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column(
            "duration_seconds",
            sa.Integer(),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["sop_id"],
            ["sops.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["employee_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "duration_seconds >= 0",
            name="ck_walkthrough_completion_duration_nonneg",
        ),
    )

    op.create_index(
        "ix_walkthrough_completion_tenant_id",
        "walkthrough_completions",
        ["tenant_id"],
    )

    op.create_index(
        "ix_walkthrough_completion_sop_id",
        "walkthrough_completions",
        ["sop_id"],
    )

    op.create_index(
        "ix_walkthrough_completion_employee_id",
        "walkthrough_completions",
        ["employee_id"],
    )

    op.create_index(
        "ix_walkthrough_completion_sop_employee",
        "walkthrough_completions",
        ["sop_id", "employee_id"],
    )

    op.create_table(
        "walkthrough_friction_events",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "completion_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "step_number",
            sa.Integer(),
            nullable=False,
        ),
        sa.Column(
            "event_type",
            sa.String(length=32),
            nullable=False,
        ),
        sa.Column(
            "occurred_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["completion_id"],
            ["walkthrough_completions.id"],
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "step_number >= 1",
            name="ck_walkthrough_friction_step_number_pos",
        ),
        sa.CheckConstraint(
            "event_type IN ('wrong_target','wrong_page','empty_input','selector_miss')",
            name="ck_walkthrough_friction_event_type",
        ),
    )

    op.create_index(
        "ix_walkthrough_friction_completion_id",
        "walkthrough_friction_events",
        ["completion_id"],
    )

    op.create_index(
        "ix_walkthrough_friction_completion_step",
        "walkthrough_friction_events",
        ["completion_id", "step_number"],
    )

    op.create_table(
        "walkthrough_step_timings",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "completion_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "step_number",
            sa.Integer(),
            nullable=False,
        ),
        sa.Column(
            "duration_ms",
            sa.Integer(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["completion_id"],
            ["walkthrough_completions.id"],
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "completion_id",
            "step_number",
            name="uq_walkthrough_step_timing_completion_step",
        ),
        sa.CheckConstraint(
            "step_number >= 1",
            name="ck_walkthrough_step_timing_step_number_pos",
        ),
        sa.CheckConstraint(
            "duration_ms >= 0",
            name="ck_walkthrough_step_timing_duration_nonneg",
        ),
    )

    op.create_index(
        "ix_walkthrough_step_timing_completion",
        "walkthrough_step_timings",
        ["completion_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_walkthrough_step_timing_completion",
        table_name="walkthrough_step_timings",
    )
    op.drop_table("walkthrough_step_timings")

    op.drop_index(
        "ix_walkthrough_friction_completion_step",
        table_name="walkthrough_friction_events",
    )
    op.drop_index(
        "ix_walkthrough_friction_completion_id",
        table_name="walkthrough_friction_events",
    )
    op.drop_table("walkthrough_friction_events")

    op.drop_index(
        "ix_walkthrough_completion_sop_employee",
        table_name="walkthrough_completions",
    )
    op.drop_index(
        "ix_walkthrough_completion_employee_id",
        table_name="walkthrough_completions",
    )
    op.drop_index(
        "ix_walkthrough_completion_sop_id",
        table_name="walkthrough_completions",
    )
    op.drop_index(
        "ix_walkthrough_completion_tenant_id",
        table_name="walkthrough_completions",
    )
    op.drop_table("walkthrough_completions")
