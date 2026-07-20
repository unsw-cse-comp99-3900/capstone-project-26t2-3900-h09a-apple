"""Add workflow_clusters and workflow_step_variance (H09AAPPLE-36).

Revision ID: 0012_workflow_clustering
Revises: 0011_sop_embed_status
Create Date: 2026-07-20
"""

from __future__ import annotations

import sqlalchemy as sa
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0012_workflow_clustering"
down_revision = "0011_sop_embed_status"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "workflow_clusters",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("workflow_name", sa.String(length=200), nullable=False),
        sa.Column("run_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("cluster_id", sa.Integer(), nullable=False),
        sa.Column("chosen_k", sa.Integer(), nullable=False),
        sa.Column("chosen_silhouette", sa.Numeric(12, 8), nullable=False),
        sa.Column(
            "candidate_silhouettes",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("centroid_vector", Vector(1536), nullable=False),
        sa.Column(
            "member_session_ids",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "high_variance_session_ids",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("run_id", "cluster_id", name="uq_workflow_clusters_run_cluster"),
        sa.CheckConstraint("cluster_id >= 0", name="ck_workflow_clusters_cluster_id_nonneg"),
        sa.CheckConstraint(
            "chosen_k >= 2 AND chosen_k <= 4",
            name="ck_workflow_clusters_chosen_k",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(member_session_ids) = 'array'",
            name="ck_workflow_clusters_member_session_ids_array",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(high_variance_session_ids) = 'array'",
            name="ck_workflow_clusters_high_variance_session_ids_array",
        ),
    )
    op.create_index(
        "ix_workflow_clusters_tenant_id",
        "workflow_clusters",
        ["tenant_id"],
    )
    op.create_index(
        "ix_workflow_clusters_run_id",
        "workflow_clusters",
        ["run_id"],
    )
    op.create_index(
        "ix_workflow_clusters_tenant_workflow_created",
        "workflow_clusters",
        ["tenant_id", "workflow_name", "created_at"],
    )

    op.create_table(
        "workflow_step_variance",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("workflow_name", sa.String(length=200), nullable=False),
        sa.Column("run_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("step_number", sa.Integer(), nullable=False),
        sa.Column("semantic_variance", sa.Numeric(12, 8), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint(
            "tenant_id",
            "workflow_name",
            "step_number",
            name="uq_workflow_step_variance_tenant_workflow_step",
        ),
        sa.CheckConstraint(
            "step_number >= 1",
            name="ck_workflow_step_variance_step_number_pos",
        ),
        sa.CheckConstraint(
            "semantic_variance >= 0",
            name="ck_workflow_step_variance_semantic_nonneg",
        ),
    )
    op.create_index(
        "ix_workflow_step_variance_run_id",
        "workflow_step_variance",
        ["run_id"],
    )
    op.create_index(
        "ix_workflow_step_variance_tenant_workflow",
        "workflow_step_variance",
        ["tenant_id", "workflow_name"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_workflow_step_variance_tenant_workflow",
        table_name="workflow_step_variance",
    )
    op.drop_index("ix_workflow_step_variance_run_id", table_name="workflow_step_variance")
    op.drop_table("workflow_step_variance")

    op.drop_index(
        "ix_workflow_clusters_tenant_workflow_created",
        table_name="workflow_clusters",
    )
    op.drop_index("ix_workflow_clusters_run_id", table_name="workflow_clusters")
    op.drop_index("ix_workflow_clusters_tenant_id", table_name="workflow_clusters")
    op.drop_table("workflow_clusters")
