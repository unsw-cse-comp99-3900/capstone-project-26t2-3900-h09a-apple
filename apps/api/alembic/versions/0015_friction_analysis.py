"""Add asynchronous friction analysis results.

Revision ID: 0015_friction_analysis
Revises: 0014_walkthrough_step_sequence
Create Date: 2026-07-28
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0015_friction_analysis"
down_revision = "0014_walkthrough_step_sequence"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "friction_analysis",
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
        sa.Column("status", sa.String(32), nullable=False, server_default="pending"),
        sa.Column("overall_score", sa.Numeric(6, 2)),
        sa.Column("highest_friction_step", sa.Integer()),
        sa.Column("employee_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "algorithm_version",
            sa.String(64),
            nullable=False,
            server_default="friction-v1",
        ),
        sa.Column("error_message", sa.Text()),
        sa.Column(
            "triggered_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint(
            "status IN ('pending','processing','completed','failed')",
            name="ck_friction_analysis_status",
        ),
        sa.CheckConstraint(
            "overall_score IS NULL OR (overall_score >= 0 AND overall_score <= 100)",
            name="ck_friction_analysis_overall_score",
        ),
        sa.CheckConstraint(
            "highest_friction_step IS NULL OR highest_friction_step >= 1",
            name="ck_friction_analysis_highest_step",
        ),
        sa.CheckConstraint(
            "employee_count >= 0",
            name="ck_friction_analysis_employee_count",
        ),
    )
    op.create_index("ix_friction_analysis_tenant_id", "friction_analysis", ["tenant_id"])
    op.create_index("ix_friction_analysis_sop_id", "friction_analysis", ["sop_id"])
    op.create_index(
        "ix_friction_analysis_tenant_sop_triggered",
        "friction_analysis",
        ["tenant_id", "sop_id", sa.text("triggered_at DESC")],
    )

    op.create_table(
        "friction_employee_step_scores",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "analysis_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("friction_analysis.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "employee_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "completion_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("walkthrough_completions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("step_number", sa.Integer(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("expected_duration_ms", sa.Integer(), nullable=False),
        sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "path_deviation_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column("score", sa.Numeric(6, 2), nullable=False),
        sa.Column(
            "is_outlier",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.UniqueConstraint(
            "analysis_id",
            "employee_id",
            "step_number",
            name="uq_friction_score_analysis_employee_step",
        ),
        sa.CheckConstraint("step_number >= 1", name="ck_friction_score_step_number"),
        sa.CheckConstraint("duration_ms >= 0", name="ck_friction_score_duration"),
        sa.CheckConstraint(
            "expected_duration_ms > 0",
            name="ck_friction_score_expected_duration",
        ),
        sa.CheckConstraint("retry_count >= 0", name="ck_friction_score_retries"),
        sa.CheckConstraint(
            "path_deviation_count >= 0",
            name="ck_friction_score_path_deviations",
        ),
        sa.CheckConstraint(
            "score >= 0 AND score <= 100",
            name="ck_friction_score_range",
        ),
    )
    op.create_index(
        "ix_friction_scores_analysis_step",
        "friction_employee_step_scores",
        ["analysis_id", "step_number"],
    )
    op.create_index(
        "ix_friction_scores_analysis_employee",
        "friction_employee_step_scores",
        ["analysis_id", "employee_id"],
    )

    op.create_table(
        "friction_step_aggregates",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "analysis_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("friction_analysis.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("step_number", sa.Integer(), nullable=False),
        sa.Column("average_score", sa.Numeric(6, 2), nullable=False),
        sa.Column("min_score", sa.Numeric(6, 2), nullable=False),
        sa.Column("max_score", sa.Numeric(6, 2), nullable=False),
        sa.Column(
            "best_employee_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
        ),
        sa.Column(
            "worst_employee_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
        ),
        sa.Column("sample_size", sa.Integer(), nullable=False),
        sa.UniqueConstraint(
            "analysis_id",
            "step_number",
            name="uq_friction_aggregate_analysis_step",
        ),
        sa.CheckConstraint(
            "step_number >= 1",
            name="ck_friction_aggregate_step_number",
        ),
        sa.CheckConstraint(
            "average_score >= 0 AND average_score <= 100",
            name="ck_friction_aggregate_average",
        ),
        sa.CheckConstraint(
            "min_score >= 0 AND min_score <= 100",
            name="ck_friction_aggregate_min",
        ),
        sa.CheckConstraint(
            "max_score >= 0 AND max_score <= 100",
            name="ck_friction_aggregate_max",
        ),
        sa.CheckConstraint(
            "min_score <= average_score AND average_score <= max_score",
            name="ck_friction_aggregate_order",
        ),
        sa.CheckConstraint(
            "sample_size >= 1",
            name="ck_friction_aggregate_sample_size",
        ),
    )
    op.create_index(
        "ix_friction_aggregates_analysis",
        "friction_step_aggregates",
        ["analysis_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_friction_aggregates_analysis", table_name="friction_step_aggregates")
    op.drop_table("friction_step_aggregates")
    op.drop_index(
        "ix_friction_scores_analysis_employee",
        table_name="friction_employee_step_scores",
    )
    op.drop_index(
        "ix_friction_scores_analysis_step",
        table_name="friction_employee_step_scores",
    )
    op.drop_table("friction_employee_step_scores")
    op.drop_index(
        "ix_friction_analysis_tenant_sop_triggered",
        table_name="friction_analysis",
    )
    op.drop_index("ix_friction_analysis_sop_id", table_name="friction_analysis")
    op.drop_index("ix_friction_analysis_tenant_id", table_name="friction_analysis")
    op.drop_table("friction_analysis")
