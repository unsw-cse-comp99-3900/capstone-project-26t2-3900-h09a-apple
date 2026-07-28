"""Add walkthrough analytics sequence and role snapshot.

Revision ID: 0014_walkthrough_step_sequence
Revises: 0013_clustering_results
Create Date: 2026-07-28
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0014_walkthrough_step_sequence"
down_revision = "0013_clustering_results"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "walkthrough_completions",
        sa.Column(
            "step_sequence",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.create_check_constraint(
        "ck_walkthrough_completion_step_sequence_array",
        "walkthrough_completions",
        "jsonb_typeof(step_sequence) = 'array'",
    )
    op.add_column(
        "walkthrough_completions",
        sa.Column(
            "user_role",
            sa.String(length=32),
            nullable=False,
            server_default="EMPLOYEE",
        ),
    )
    op.create_check_constraint(
        "ck_walkthrough_completion_user_role",
        "walkthrough_completions",
        "user_role IN ('EMPLOYEE','REVIEWER','MANAGER')",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_walkthrough_completion_user_role",
        "walkthrough_completions",
        type_="check",
    )
    op.drop_column("walkthrough_completions", "user_role")
    op.drop_constraint(
        "ck_walkthrough_completion_step_sequence_array",
        "walkthrough_completions",
        type_="check",
    )
    op.drop_column("walkthrough_completions", "step_sequence")
