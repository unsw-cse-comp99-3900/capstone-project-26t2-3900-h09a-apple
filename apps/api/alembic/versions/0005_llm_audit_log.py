from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0005_llm_audit_log"
down_revision = "0004_sop_generation_mode"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "llm_audit_log",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("provider", sa.String(length=64), nullable=False),
        sa.Column("model", sa.String(length=128), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("attempt", sa.Integer(), nullable=False),
        sa.Column("prompt_tokens", sa.Integer()),
        sa.Column("completion_tokens", sa.Integer()),
        sa.Column("latency_ms", sa.Integer(), nullable=False),
        sa.Column("cost_usd", sa.Numeric(12, 8)),
        sa.Column("error_message", sa.Text()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["session_id"], ["sessions.id"], ondelete="CASCADE"),
        sa.CheckConstraint(
            "status IN ('success','error')",
            name="ck_llm_audit_log_status",
        ),
        sa.CheckConstraint("attempt >= 1", name="ck_llm_audit_log_attempt_pos"),
        sa.CheckConstraint(
            "prompt_tokens IS NULL OR prompt_tokens >= 0",
            name="ck_llm_audit_log_prompt_tokens_nonneg",
        ),
        sa.CheckConstraint(
            "completion_tokens IS NULL OR completion_tokens >= 0",
            name="ck_llm_audit_log_completion_tokens_nonneg",
        ),
        sa.CheckConstraint("latency_ms >= 0", name="ck_llm_audit_log_latency_nonneg"),
        sa.CheckConstraint(
            "cost_usd IS NULL OR cost_usd >= 0",
            name="ck_llm_audit_log_cost_nonneg",
        ),
    )

    op.create_index("ix_llm_audit_log_session_id", "llm_audit_log", ["session_id"])
    op.create_index(
        "ix_llm_audit_log_session_created",
        "llm_audit_log",
        ["session_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_llm_audit_log_session_created", table_name="llm_audit_log")
    op.drop_index("ix_llm_audit_log_session_id", table_name="llm_audit_log")
    op.drop_table("llm_audit_log")