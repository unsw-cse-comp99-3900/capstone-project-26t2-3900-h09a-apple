from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0004_sop_generation_mode"
down_revision = "0003_users_and_sop_tenant"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "sops",
        sa.Column(
            "generation_mode",
            sa.String(length=32),
            nullable=False,
            server_default="llm",
        ),
    )
    op.create_check_constraint(
        "ck_sops_generation_mode",
        "sops",
        "generation_mode IN ('llm','fallback')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_sops_generation_mode", "sops", type_="check")
    op.drop_column("sops", "generation_mode")
