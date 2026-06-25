"""Add users table and tenant_id on sops (H09AAPPLE-42).

Revision ID: 0003_users_and_sop_tenant
Revises: 0002_codification_jobs
Create Date: 2026-06-17
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0003_users_and_sop_tenant"
down_revision = "0002_codification_jobs"
branch_labels = None
depends_on = None

DEV_TENANT_ID = "22222222-2222-2222-2222-222222222222"


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("hashed_password", sa.String(length=255), nullable=False),
        sa.Column("role", sa.String(length=32), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email", name="uq_users_email"),
        sa.CheckConstraint(
            "role IN ('EMPLOYEE','REVIEWER','MANAGER')",
            name="ck_users_role",
        ),
    )
    op.create_index("ix_users_tenant_id", "users", ["tenant_id"])

    op.add_column(
        "sops",
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.execute(
        sa.text(
            """
            UPDATE sops
            SET tenant_id = sessions.tenant_id
            FROM sessions
            WHERE sops.session_id = sessions.id
            """
        )
    )
    op.alter_column(
        "sops",
        "tenant_id",
        nullable=False,
        server_default=sa.text(f"'{DEV_TENANT_ID}'::uuid"),
    )
    op.create_index("ix_sops_tenant_id", "sops", ["tenant_id"])


def downgrade() -> None:
    op.drop_index("ix_sops_tenant_id", table_name="sops")
    op.drop_column("sops", "tenant_id")
    op.drop_index("ix_users_tenant_id", table_name="users")
    op.drop_table("users")
