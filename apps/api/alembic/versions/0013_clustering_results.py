"""Add tenant-scoped K-means clustering result history.

Revision ID: 0013_clustering_results
Revises: 0012_workflow_clustering
Create Date: 2026-07-28
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0013_clustering_results"
down_revision = "0012_workflow_clustering"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "clustering_results",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "workflow_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sops.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("k", sa.Integer(), nullable=False),
        sa.Column("cluster_centers", postgresql.JSONB(), nullable=False),
        sa.Column("session_cluster_assignments", postgresql.JSONB(), nullable=False),
        sa.Column("clusters", postgresql.JSONB(), nullable=False),
        sa.Column("outliers", postgresql.JSONB(), nullable=False),
        sa.Column("silhouette", sa.Float(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(), nullable=False),
        sa.Column("algorithm_version", sa.String(length=64), nullable=False),
        sa.Column(
            "computed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint("k >= 2 AND k <= 4", name="ck_clustering_results_k"),
    )
    op.create_index(
        "ix_clustering_results_tenant_workflow_computed",
        "clustering_results",
        ["tenant_id", "workflow_id", sa.text("computed_at DESC")],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_clustering_results_tenant_workflow_computed",
        table_name="clustering_results",
    )
    op.drop_table("clustering_results")
