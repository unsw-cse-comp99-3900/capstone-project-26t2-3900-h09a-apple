"""Append-only consent acceptance history (H09AAPPLE-59).

Revision ID: 0007_consent_acceptance
Revises: 0006_add_published_at
Create Date: 2026-07-11
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0007_consent_acceptance"
down_revision = "0006_add_published_at"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "consent_acceptance",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("consent_type", sa.String(length=32), nullable=False),
        sa.Column("version", sa.String(length=64), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.CheckConstraint(
            "consent_type IN ('recording','walkthrough')",
            name="ck_consent_acceptance_type",
        ),
        sa.CheckConstraint(
            "length(trim(version)) > 0",
            name="ck_consent_acceptance_version_nonempty",
        ),
    )
    op.create_index(
        "ix_consent_acceptance_tenant_id",
        "consent_acceptance",
        ["tenant_id"],
    )
    op.execute(
        """
        CREATE INDEX ix_consent_acceptance_user_type_accepted
            ON consent_acceptance (user_id, consent_type, accepted_at DESC)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_consent_acceptance_user_type_accepted")
    op.drop_index("ix_consent_acceptance_tenant_id", table_name="consent_acceptance")
    op.drop_table("consent_acceptance")
