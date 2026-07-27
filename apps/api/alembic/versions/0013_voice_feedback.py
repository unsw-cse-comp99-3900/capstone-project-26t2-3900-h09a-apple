"""Add voice_feedbacks and feedback_notifications (H09AAPPLE-33).

Revision ID: 0013_voice_feedback
Revises: 0012_workflow_clustering
Create Date: 2026-07-28
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0013_voice_feedback"
down_revision = "0012_workflow_clustering"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "voice_feedbacks",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "employee_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "sop_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sops.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("audio_object_key", sa.String(length=512), nullable=False),
        sa.Column("content_type", sa.String(length=128), nullable=False),
        sa.Column("duration_seconds", sa.Numeric(10, 3), nullable=False),
        sa.Column("transcript", sa.Text(), nullable=False),
        sa.Column("language", sa.String(length=32)),
        sa.Column("classification", sa.String(length=32), nullable=False),
        sa.Column("polarity", sa.String(length=32), nullable=False),
        sa.Column("severity", sa.String(length=16), nullable=False),
        sa.Column(
            "status",
            sa.String(length=32),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("reviewer_comment", sa.Text()),
        sa.Column(
            "reviewer_tags",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "reviewed_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("reviewed_at", sa.DateTime(timezone=True)),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
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
            "classification IN ('friction','question','suggestion')",
            name="ck_voice_feedbacks_classification",
        ),
        sa.CheckConstraint(
            "polarity IN ('issue','positive')",
            name="ck_voice_feedbacks_polarity",
        ),
        sa.CheckConstraint(
            "severity IN ('high','medium','low')",
            name="ck_voice_feedbacks_severity",
        ),
        sa.CheckConstraint(
            "status IN ('pending','reviewed')",
            name="ck_voice_feedbacks_status",
        ),
        sa.CheckConstraint(
            "duration_seconds >= 0",
            name="ck_voice_feedbacks_duration_nonneg",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(reviewer_tags) = 'array'",
            name="ck_voice_feedbacks_reviewer_tags_array",
        ),
    )
    op.create_index("ix_voice_feedbacks_tenant_id", "voice_feedbacks", ["tenant_id"])
    op.create_index("ix_voice_feedbacks_employee_id", "voice_feedbacks", ["employee_id"])
    op.create_index("ix_voice_feedbacks_sop_id", "voice_feedbacks", ["sop_id"])
    op.create_index(
        "ix_voice_feedbacks_tenant_severity",
        "voice_feedbacks",
        ["tenant_id", "severity"],
    )
    op.create_index(
        "ix_voice_feedbacks_tenant_status",
        "voice_feedbacks",
        ["tenant_id", "status"],
    )
    op.create_index(
        "ix_voice_feedbacks_employee_sop",
        "voice_feedbacks",
        ["employee_id", "sop_id"],
    )

    op.create_table(
        "feedback_notifications",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "recipient_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "feedback_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("voice_feedbacks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "delivered_via",
            sa.String(length=32),
            nullable=False,
            server_default="inbox",
        ),
        sa.Column("read_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "ix_feedback_notifications_tenant_id",
        "feedback_notifications",
        ["tenant_id"],
    )
    op.create_index(
        "ix_feedback_notifications_recipient_id",
        "feedback_notifications",
        ["recipient_id"],
    )
    op.create_index(
        "ix_feedback_notifications_feedback_id",
        "feedback_notifications",
        ["feedback_id"],
    )
    op.create_index(
        "ix_feedback_notifications_recipient_unread",
        "feedback_notifications",
        ["recipient_id", "read_at", "created_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_feedback_notifications_recipient_unread",
        table_name="feedback_notifications",
    )
    op.drop_index(
        "ix_feedback_notifications_feedback_id",
        table_name="feedback_notifications",
    )
    op.drop_index(
        "ix_feedback_notifications_recipient_id",
        table_name="feedback_notifications",
    )
    op.drop_index(
        "ix_feedback_notifications_tenant_id",
        table_name="feedback_notifications",
    )
    op.drop_table("feedback_notifications")

    op.drop_index("ix_voice_feedbacks_employee_sop", table_name="voice_feedbacks")
    op.drop_index("ix_voice_feedbacks_tenant_status", table_name="voice_feedbacks")
    op.drop_index("ix_voice_feedbacks_tenant_severity", table_name="voice_feedbacks")
    op.drop_index("ix_voice_feedbacks_sop_id", table_name="voice_feedbacks")
    op.drop_index("ix_voice_feedbacks_employee_id", table_name="voice_feedbacks")
    op.drop_index("ix_voice_feedbacks_tenant_id", table_name="voice_feedbacks")
    op.drop_table("voice_feedbacks")
