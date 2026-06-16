"""Sprint 1 initial schema (H09AAPPLE-15).

Creates the four core tables (sessions, events, screenshots, sops) plus the
``pgcrypto`` extension for ``gen_random_uuid()``, the generated ``occurred_at``
column on ``events``, the BRIN time-range index, and all ``COMMENT ON COLUMN``
PII annotations.

Hand-written rather than ``--autogenerate``-d so that the generated column,
the BRIN index, and the column comments are guaranteed to land. Autogenerate
support for ``GENERATED ALWAYS AS`` is good in SQLAlchemy 2.0 but not 100%,
and it never emits ``COMMENT ON COLUMN``.

Run with::

    DATABASE_URL=postgresql+psycopg://user:pass@localhost/dbname \
        alembic upgrade head

Revision ID: 0001_init
Revises:
Create Date: 2026-06-16
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0001_init"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # gen_random_uuid() lives in pgcrypto; required for all UUID PK defaults.
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")

    # -----------------------------------------------------------------------
    # sessions
    # -----------------------------------------------------------------------
    op.create_table(
        "sessions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column("client_session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("recorded_by", postgresql.UUID(as_uuid=True)),
        sa.Column("workflow_name", sa.String(length=200), nullable=False),
        sa.Column(
            "status",
            sa.String(length=32),
            nullable=False,
            server_default="recording",
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("stopped_at", sa.DateTime(timezone=True)),
        sa.Column("event_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("client_session_id", name="uq_sessions_client_session_id"),
        sa.CheckConstraint(
            "status IN ('recording','captured','submitted','processed','failed')",
            name="ck_sessions_status",
        ),
        sa.CheckConstraint(
            "stopped_at IS NULL OR stopped_at >= started_at",
            name="ck_sessions_time_order",
        ),
        sa.CheckConstraint("event_count >= 0", name="ck_sessions_event_count_nonneg"),
        sa.CheckConstraint(
            "length(trim(workflow_name)) > 0",
            name="ck_sessions_workflow_name_nonempty",
        ),
    )
    op.execute(
        """
        CREATE INDEX ix_sessions_tenant_started
            ON sessions (tenant_id, started_at DESC)
            WHERE deleted_at IS NULL
        """
    )
    op.execute(
        """
        CREATE INDEX ix_sessions_user_started
            ON sessions (recorded_by, started_at DESC)
            WHERE deleted_at IS NULL
        """
    )

    # -----------------------------------------------------------------------
    # screenshots (created before events because events.screenshot_id FKs here)
    # -----------------------------------------------------------------------
    op.create_table(
        "screenshots",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column(
            "session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("object_key", sa.String(length=500), nullable=False, unique=True),
        sa.Column("width", sa.Integer()),
        sa.Column("height", sa.Integer()),
        sa.Column("bytes", sa.BigInteger()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint("width IS NULL OR width > 0", name="ck_screenshots_width_pos"),
        sa.CheckConstraint("height IS NULL OR height > 0", name="ck_screenshots_height_pos"),
        sa.CheckConstraint("bytes IS NULL OR bytes >= 0", name="ck_screenshots_bytes_nonneg"),
    )
    op.create_index("ix_screenshots_session_id", "screenshots", ["session_id"])

    # -----------------------------------------------------------------------
    # events
    # -----------------------------------------------------------------------
    op.create_table(
        "events",
        sa.Column(
            "id",
            sa.BigInteger(),
            sa.Identity(always=True),
            primary_key=True,
        ),
        sa.Column(
            "session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("type", sa.String(length=32), nullable=False),
        sa.Column("target_selector", sa.Text()),
        sa.Column("target_label", sa.Text()),
        sa.Column("value", sa.Text()),
        sa.Column("url", sa.Text()),
        sa.Column(
            "attrs",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "screenshot_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("screenshots.id", ondelete="SET NULL"),
        ),
        sa.Column("timestamp_ms", sa.BigInteger(), nullable=False),
        # occurred_at is added below as a GENERATED column (DDL form not fully
        # supported by op.create_table across alembic versions).
        sa.Column(
            "ingested_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("session_id", "seq", name="uq_events_session_seq"),
        sa.CheckConstraint("seq >= 0", name="ck_events_seq_nonneg"),
        sa.CheckConstraint(
            "type IN ('click','navigation','input','submit','tab_switch')",
            name="ck_events_type",
        ),
        sa.CheckConstraint(
            "value IS NULL OR length(value) <= 10000",
            name="ck_events_value_len",
        ),
        sa.CheckConstraint("timestamp_ms > 0", name="ck_events_timestamp_ms_pos"),
    )
    op.execute(
        """
        ALTER TABLE events
            ADD COLUMN occurred_at TIMESTAMPTZ
            GENERATED ALWAYS AS (to_timestamp(timestamp_ms / 1000.0)) STORED NOT NULL
        """
    )
    op.create_index("ix_events_session_seq", "events", ["session_id", "seq"])
    op.create_index("ix_events_session_type", "events", ["session_id", "type"])
    op.execute(
        """
        CREATE INDEX ix_events_occurred_brin
            ON events USING BRIN (occurred_at)
        """
    )

    # -----------------------------------------------------------------------
    # sops
    # -----------------------------------------------------------------------
    op.create_table(
        "sops",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column(
            "session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sessions.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column(
            "status",
            sa.String(length=32),
            nullable=False,
            server_default="draft",
        ),
        sa.Column(
            "steps",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "warnings",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "generated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("gen_duration_ms", sa.Integer()),
        sa.UniqueConstraint("session_id", "version", name="uq_sops_session_version"),
        sa.CheckConstraint(
            "status IN ('draft','needs_review','approved','published')",
            name="ck_sops_status",
        ),
        sa.CheckConstraint("version >= 1", name="ck_sops_version_pos"),
        sa.CheckConstraint(
            "gen_duration_ms IS NULL OR gen_duration_ms >= 0",
            name="ck_sops_gen_duration_nonneg",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(steps) = 'array'",
            name="ck_sops_steps_array",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(warnings) = 'array'",
            name="ck_sops_warnings_array",
        ),
    )
    op.create_index("ix_sops_session_status", "sops", ["session_id", "status"])
    op.create_index("ix_sops_session_id", "sops", ["session_id"])

    # -----------------------------------------------------------------------
    # PII / context COMMENT ON COLUMN annotations (single source of truth)
    # -----------------------------------------------------------------------
    op.execute(
        "COMMENT ON COLUMN sessions.client_session_id IS "
        "'Idempotency key from extension; protects against retried flushes.'"
    )
    op.execute(
        "COMMENT ON COLUMN sessions.recorded_by IS "
        "'PII: FK-by-convention to users (table deferred). "
        "Nullable until auth lands; tighten to NOT NULL with that migration.'"
    )
    op.execute(
        "COMMENT ON COLUMN events.value IS "
        "'PII: stored post-masking by content script (H09AAPPLE-11). "
        "Never write raw input. CHECK length <= 10000.'"
    )
    op.execute(
        "COMMENT ON COLUMN events.target_label IS "
        "'PII-risk: may contain on-screen text. Not masked.'"
    )
    op.execute(
        "COMMENT ON COLUMN events.url IS "
        "'PII-risk: query strings may carry ids/emails. "
        "URL masking deferred to ingestion in H09AAPPLE-14.'"
    )
    op.execute(
        "COMMENT ON COLUMN events.attrs IS "
        "'PII-risk: open JSONB bag; reviewers must whitelist what producers put here.'"
    )
    op.execute(
        "COMMENT ON COLUMN events.occurred_at IS "
        "'Generated from timestamp_ms; do not write directly.'"
    )
    op.execute(
        "COMMENT ON COLUMN sops.steps IS "
        "'PII-risk: LLM output may echo masked input; reviewer should redact before publish.'"
    )


def downgrade() -> None:
    # Order matters: drop dependents first.
    op.drop_index("ix_sops_session_id", table_name="sops")
    op.drop_index("ix_sops_session_status", table_name="sops")
    op.drop_table("sops")

    op.execute("DROP INDEX IF EXISTS ix_events_occurred_brin")
    op.drop_index("ix_events_session_type", table_name="events")
    op.drop_index("ix_events_session_seq", table_name="events")
    op.drop_table("events")

    op.drop_index("ix_screenshots_session_id", table_name="screenshots")
    op.drop_table("screenshots")

    op.execute("DROP INDEX IF EXISTS ix_sessions_user_started")
    op.execute("DROP INDEX IF EXISTS ix_sessions_tenant_started")
    op.drop_table("sessions")

    # pgcrypto deliberately not dropped: may be in use by other schemas.
