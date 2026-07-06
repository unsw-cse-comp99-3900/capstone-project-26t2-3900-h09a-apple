from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0006_add_published_at"
down_revision = "0005_llm_audit_log"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # -----------------------------------------------------------------------
    # sops
    # -----------------------------------------------------------------------
    # Add the publication timestamp. It remains NULL until a Reviewer
    # publishes the SOP through the publish endpoint.
    op.add_column(
        "sops",
        sa.Column(
            "published_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )


def downgrade() -> None:
    # Remove the publication timestamp column.
    op.drop_column("sops", "published_at")
