"""SQLAlchemy models for Sprint 1 (H09AAPPLE-15).

The authoritative description of the schema lives in ``docs/db-schema.md``.
This module is the Python rendering of that contract; field names and types
must stay 1:1 with both the markdown doc and ``packages/types/src/session.ts``.

A few design choices worth flagging when reading this file:

* ``events.id`` is ``BIGINT IDENTITY``, not UUID. Events are the hot/large
  table and UUID PKs bloat indexes and fragment inserts.
* Enum-like columns are ``VARCHAR(32) + CHECK`` rather than Postgres native
  ``ENUM`` types. Native ENUMs cannot have values added inside a transaction,
  which makes evolving them (``tab_switch``, ``keypress``, ``scroll`` …)
  painful.
* ``events.occurred_at`` is a Postgres generated column. It is declared in the
  Alembic migration (autogenerate cannot emit ``GENERATED ALWAYS AS``); here
  we expose it as a read-only mapped column so ORM code can read it.
* PII column comments are added by the migration via ``COMMENT ON COLUMN``,
  not here, so the DB itself stays the single source of truth for tooling.
"""

from __future__ import annotations

import enum

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    Computed,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


# ---------------------------------------------------------------------------
# Enum-like value sets (mapped to VARCHAR + CHECK, not Postgres ENUM)
# ---------------------------------------------------------------------------
class SessionStatus(str, enum.Enum):
    recording = "recording"
    captured = "captured"
    submitted = "submitted"
    processed = "processed"
    failed = "failed"


class EventType(str, enum.Enum):
    click = "click"
    navigation = "navigation"
    input = "input"
    submit = "submit"
    tab_switch = "tab_switch"


class SopStatus(str, enum.Enum):
    draft = "draft"
    needs_review = "needs_review"
    approved = "approved"
    published = "published"


class CodificationJobStatus(str, enum.Enum):
    pending = "pending"
    processing = "processing"
    completed = "completed"
    failed = "failed"


class CodificationJobType(str, enum.Enum):
    generate = "generate"
    embed = "embed"


class EmbeddingStatus(str, enum.Enum):
    pending = "pending"
    complete = "complete"
    failed = "failed"


class UserRole(str, enum.Enum):
    employee = "EMPLOYEE"
    reviewer = "REVIEWER"
    manager = "MANAGER"


class ConsentType(str, enum.Enum):
    recording = "recording"
    walkthrough = "walkthrough"


def _csv(values: type[enum.Enum]) -> str:
    """Format an Enum as ``'a','b','c'`` for use inside an SQL CHECK clause."""
    return ",".join(f"'{member.value}'" for member in values)


class User(Base):
    __tablename__ = "users"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    email = Column(String(255), nullable=False, unique=True)
    hashed_password = Column(String(255), nullable=False)
    role = Column(String(32), nullable=False)
    tenant_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    __table_args__ = (CheckConstraint(f"role IN ({_csv(UserRole)})", name="ck_users_role"),)


class RefreshToken(Base):
    """Issued refresh-token jtis for server-side revocation (H09AAPPLE-63)."""

    __tablename__ = "refresh_tokens"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    jti = Column(UUID(as_uuid=True), nullable=False, unique=True)
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    expires_at = Column(DateTime(timezone=True), nullable=False)
    revoked_at = Column(DateTime(timezone=True))
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )


class PasswordResetToken(Base):
    """One-time password reset tokens; only the hash is stored (H09AAPPLE-63)."""

    __tablename__ = "password_reset_tokens"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    token_hash = Column(String(64), nullable=False, unique=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    used_at = Column(DateTime(timezone=True))
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )


class WalkthroughFrictionType(str, enum.Enum):
    wrong_target = "wrong_target"
    wrong_page = "wrong_page"
    empty_input = "empty_input"
    selector_miss = "selector_miss"


# ---------------------------------------------------------------------------
# sessions
# ---------------------------------------------------------------------------
class Session(Base):
    __tablename__ = "sessions"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    client_session_id = Column(UUID(as_uuid=True), nullable=False, unique=True)
    tenant_id = Column(UUID(as_uuid=True), nullable=False)
    # Nullable until the auth/users card (deferred from H09AAPPLE-15 OoS) lands.
    # Will be backfilled with the resolved user UUID and tightened to NOT NULL then.
    recorded_by = Column(UUID(as_uuid=True))
    workflow_name = Column(String(200), nullable=False)
    status = Column(
        String(32),
        nullable=False,
        server_default=SessionStatus.recording.value,
    )
    started_at = Column(DateTime(timezone=True), nullable=False)
    stopped_at = Column(DateTime(timezone=True))
    event_count = Column(Integer, nullable=False, server_default="0")
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    deleted_at = Column(DateTime(timezone=True))

    events = relationship(
        "Event",
        back_populates="session",
        cascade="all, delete-orphan",
    )
    screenshots = relationship(
        "Screenshot",
        back_populates="session",
        cascade="all, delete-orphan",
    )
    # No cascade on sops: generated SOPs survive their source session by design.
    sops = relationship("Sop", back_populates="session")
    codification_jobs = relationship(
        "CodificationJob",
        back_populates="session",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        CheckConstraint(
            f"status IN ({_csv(SessionStatus)})",
            name="ck_sessions_status",
        ),
        CheckConstraint(
            "stopped_at IS NULL OR stopped_at >= started_at",
            name="ck_sessions_time_order",
        ),
        CheckConstraint("event_count >= 0", name="ck_sessions_event_count_nonneg"),
        CheckConstraint(
            "length(trim(workflow_name)) > 0",
            name="ck_sessions_workflow_name_nonempty",
        ),
        Index(
            "ix_sessions_tenant_started",
            "tenant_id",
            text("started_at DESC"),
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index(
            "ix_sessions_user_started",
            "recorded_by",
            text("started_at DESC"),
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )


# ---------------------------------------------------------------------------
# events
# ---------------------------------------------------------------------------
class Event(Base):
    __tablename__ = "events"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    session_id = Column(
        UUID(as_uuid=True),
        ForeignKey("sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    seq = Column(Integer, nullable=False)
    type = Column(String(32), nullable=False)
    target_selector = Column(Text)
    target_label = Column(Text)  # PII-risk; documented in DB comment
    value = Column(Text)  # PII; masked at capture in H09AAPPLE-11
    url = Column(Text)
    attrs = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    screenshot_id = Column(
        UUID(as_uuid=True),
        ForeignKey("screenshots.id", ondelete="SET NULL"),
    )
    timestamp_ms = Column(BigInteger, nullable=False)
    # Declared in SQL as: GENERATED ALWAYS AS (to_timestamp(timestamp_ms/1000.0)) STORED.
    # SQLAlchemy's Computed() prevents writes through the ORM.
    occurred_at = Column(
        DateTime(timezone=True),
        Computed("to_timestamp(timestamp_ms / 1000.0)", persisted=True),
        nullable=False,
    )
    ingested_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    session = relationship("Session", back_populates="events")

    __table_args__ = (
        UniqueConstraint("session_id", "seq", name="uq_events_session_seq"),
        CheckConstraint("seq >= 0", name="ck_events_seq_nonneg"),
        CheckConstraint(f"type IN ({_csv(EventType)})", name="ck_events_type"),
        CheckConstraint(
            "value IS NULL OR length(value) <= 10000",
            name="ck_events_value_len",
        ),
        CheckConstraint("timestamp_ms > 0", name="ck_events_timestamp_ms_pos"),
        Index("ix_events_session_seq", "session_id", "seq"),
        Index("ix_events_session_type", "session_id", "type"),
        # BRIN index on occurred_at is added in the migration (not expressible
        # cleanly via __table_args__ across SQLAlchemy versions).
    )


# ---------------------------------------------------------------------------
# screenshots
# ---------------------------------------------------------------------------
class Screenshot(Base):
    __tablename__ = "screenshots"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    session_id = Column(
        UUID(as_uuid=True),
        ForeignKey("sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    object_key = Column(String(500), nullable=False, unique=True)
    width = Column(Integer)
    height = Column(Integer)
    # BigInteger because full-page screenshots of long pages can exceed INT4 max (~2 GB).
    bytes = Column(BigInteger)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    session = relationship("Session", back_populates="screenshots")

    __table_args__ = (
        CheckConstraint(
            "width IS NULL OR width > 0",
            name="ck_screenshots_width_pos",
        ),
        CheckConstraint(
            "height IS NULL OR height > 0",
            name="ck_screenshots_height_pos",
        ),
        CheckConstraint(
            "bytes IS NULL OR bytes >= 0",
            name="ck_screenshots_bytes_nonneg",
        ),
    )


# ---------------------------------------------------------------------------
# CodificationJob
# ---------------------------------------------------------------------------
class CodificationJob(Base):
    __tablename__ = "codification_jobs"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    session_id = Column(
        UUID(as_uuid=True),
        ForeignKey("sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    job_type = Column(
        String(32),
        nullable=False,
        server_default=CodificationJobType.generate.value,
        index=True,
    )
    sop_id = Column(
        UUID(as_uuid=True),
        ForeignKey("sops.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    status = Column(
        String(32),
        nullable=False,
        server_default=CodificationJobStatus.pending.value,
    )
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    session = relationship("Session", back_populates="codification_jobs")

    __table_args__ = (
        CheckConstraint(
            f"status IN ({_csv(CodificationJobStatus)})",
            name="ck_codification_jobs_status",
        ),
        CheckConstraint(
            f"job_type IN ({_csv(CodificationJobType)})",
            name="ck_codification_jobs_job_type",
        ),
        Index("ix_codification_jobs_status_created", "status", "created_at"),
    )


# ---------------------------------------------------------------------------
# sops
# ---------------------------------------------------------------------------
class Sop(Base):
    __tablename__ = "sops"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    # RESTRICT: generated SOPs must outlive their source session unless detached.
    session_id = Column(
        UUID(as_uuid=True),
        ForeignKey("sessions.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    tenant_id = Column(
        UUID(as_uuid=True),
        nullable=False,
        index=True,
        server_default=text("'22222222-2222-2222-2222-222222222222'::uuid"),
    )
    title = Column(String(300), nullable=False)
    version = Column(Integer, nullable=False, server_default="1")
    status = Column(
        String(32),
        nullable=False,
        server_default=SopStatus.draft.value,
    )
    steps = Column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    warnings = Column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    generation_mode = Column(
        String(32),
        nullable=False,
        server_default="llm",
    )
    generated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    published_at = Column(
        DateTime(timezone=True),
        nullable=True,
    )
    gen_duration_ms = Column(Integer)
    embedding_status = Column(String(32), nullable=True)

    session = relationship("Session", back_populates="sops")
    step_embeddings = relationship(
        "SopStepEmbedding",
        back_populates="sop",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        UniqueConstraint("session_id", "version", name="uq_sops_session_version"),
        CheckConstraint(f"status IN ({_csv(SopStatus)})", name="ck_sops_status"),
        CheckConstraint("version >= 1", name="ck_sops_version_pos"),
        CheckConstraint(
            "gen_duration_ms IS NULL OR gen_duration_ms >= 0",
            name="ck_sops_gen_duration_nonneg",
        ),
        CheckConstraint("jsonb_typeof(steps) = 'array'", name="ck_sops_steps_array"),
        CheckConstraint(
            "jsonb_typeof(warnings) = 'array'",
            name="ck_sops_warnings_array",
        ),
        Index("ix_sops_session_status", "session_id", "status"),
        CheckConstraint(
            "generation_mode IN ('llm','fallback')",
            name="ck_sops_generation_mode",
        ),
        CheckConstraint(
            f"embedding_status IS NULL OR embedding_status IN ({_csv(EmbeddingStatus)})",
            name="ck_sops_embedding_status",
        ),
    )


class SopStepEmbedding(Base):
    __tablename__ = "sop_step_embedding"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    sop_id = Column(
        UUID(as_uuid=True),
        ForeignKey("sops.id", ondelete="CASCADE"),
        nullable=False,
    )
    step_number = Column(Integer, nullable=False)
    embedding = Column(Vector(1536), nullable=False)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    sop = relationship("Sop", back_populates="step_embeddings")

    __table_args__ = (
        UniqueConstraint("sop_id", "step_number", name="uq_sop_step_embedding_sop_step"),
        CheckConstraint("step_number >= 1", name="ck_sop_step_embedding_step_number_pos"),
        Index("ix_sop_step_embedding_sop_id", "sop_id"),
    )


class ClusteringResult(Base):
    """Historical tenant-scoped K-means analytics result."""

    __tablename__ = "clustering_results"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    tenant_id = Column(UUID(as_uuid=True), nullable=False)
    workflow_id = Column(
        UUID(as_uuid=True),
        ForeignKey("sops.id", ondelete="CASCADE"),
        nullable=False,
    )
    k = Column(Integer, nullable=False)
    cluster_centers = Column(JSONB, nullable=False)
    session_cluster_assignments = Column(JSONB, nullable=False)
    clusters = Column(JSONB, nullable=False)
    outliers = Column(JSONB, nullable=False)
    silhouette = Column(Float, nullable=True)
    analytics_metadata = Column("metadata", JSONB, nullable=False)
    algorithm_version = Column(String(64), nullable=False)
    computed_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    __table_args__ = (
        CheckConstraint("k >= 2 AND k <= 4", name="ck_clustering_results_k"),
        Index(
            "ix_clustering_results_tenant_workflow_computed",
            "tenant_id",
            "workflow_id",
            text("computed_at DESC"),
        ),
    )


class WorkflowCluster(Base):
    """One cluster from a workflow variance run (H09AAPPLE-36)."""

    __tablename__ = "workflow_clusters"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    tenant_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    workflow_name = Column(String(200), nullable=False)
    run_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    cluster_id = Column(Integer, nullable=False)
    chosen_k = Column(Integer, nullable=False)
    chosen_silhouette = Column(Numeric(12, 8), nullable=False)
    candidate_silhouettes = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    centroid_vector = Column(Vector(1536), nullable=False)
    member_session_ids = Column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    high_variance_session_ids = Column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    __table_args__ = (
        UniqueConstraint(
            "run_id",
            "cluster_id",
            name="uq_workflow_clusters_run_cluster",
        ),
        CheckConstraint("cluster_id >= 0", name="ck_workflow_clusters_cluster_id_nonneg"),
        CheckConstraint("chosen_k >= 2 AND chosen_k <= 4", name="ck_workflow_clusters_chosen_k"),
        CheckConstraint(
            "jsonb_typeof(member_session_ids) = 'array'",
            name="ck_workflow_clusters_member_session_ids_array",
        ),
        CheckConstraint(
            "jsonb_typeof(high_variance_session_ids) = 'array'",
            name="ck_workflow_clusters_high_variance_session_ids_array",
        ),
        Index(
            "ix_workflow_clusters_tenant_workflow_created",
            "tenant_id",
            "workflow_name",
            "created_at",
        ),
    )


class WorkflowStepVariance(Base):
    """Per-step semantic divergence across sessions of one workflow (H09AAPPLE-36)."""

    __tablename__ = "workflow_step_variance"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    tenant_id = Column(UUID(as_uuid=True), nullable=False)
    workflow_name = Column(String(200), nullable=False)
    run_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    step_number = Column(Integer, nullable=False)
    semantic_variance = Column(Numeric(12, 8), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "workflow_name",
            "step_number",
            name="uq_workflow_step_variance_tenant_workflow_step",
        ),
        CheckConstraint("step_number >= 1", name="ck_workflow_step_variance_step_number_pos"),
        CheckConstraint(
            "semantic_variance >= 0",
            name="ck_workflow_step_variance_semantic_nonneg",
        ),
        Index(
            "ix_workflow_step_variance_tenant_workflow",
            "tenant_id",
            "workflow_name",
        ),
    )


class LlmAuditLog(Base):
    __tablename__ = "llm_audit_log"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    session_id = Column(
        UUID(as_uuid=True),
        ForeignKey("sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    provider = Column(String(64), nullable=False)
    model = Column(String(128), nullable=False)
    status = Column(String(32), nullable=False)
    attempt = Column(Integer, nullable=False)
    prompt_tokens = Column(Integer)
    completion_tokens = Column(Integer)
    latency_ms = Column(Integer, nullable=False)
    cost_usd = Column(Numeric(12, 8))
    error_message = Column(Text)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    __table_args__ = (
        CheckConstraint(
            "status IN ('success','error')",
            name="ck_llm_audit_log_status",
        ),
        CheckConstraint("attempt >= 1", name="ck_llm_audit_log_attempt_pos"),
        CheckConstraint(
            "prompt_tokens IS NULL OR prompt_tokens >= 0",
            name="ck_llm_audit_log_prompt_tokens_nonneg",
        ),
        CheckConstraint(
            "completion_tokens IS NULL OR completion_tokens >= 0",
            name="ck_llm_audit_log_completion_tokens_nonneg",
        ),
        CheckConstraint("latency_ms >= 0", name="ck_llm_audit_log_latency_nonneg"),
        CheckConstraint(
            "cost_usd IS NULL OR cost_usd >= 0",
            name="ck_llm_audit_log_cost_nonneg",
        ),
        Index("ix_llm_audit_log_session_created", "session_id", "created_at"),
    )


# ---------------------------------------------------------------------------
# consent_acceptance (append-only; H09AAPPLE-59)
# ---------------------------------------------------------------------------
class ConsentAcceptance(Base):
    __tablename__ = "consent_acceptance"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    tenant_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    consent_type = Column(String(32), nullable=False)
    version = Column(String(64), nullable=False)
    accepted_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    __table_args__ = (
        CheckConstraint(
            f"consent_type IN ({_csv(ConsentType)})",
            name="ck_consent_acceptance_type",
        ),
        CheckConstraint(
            "length(trim(version)) > 0",
            name="ck_consent_acceptance_version_nonempty",
        ),
        Index(
            "ix_consent_acceptance_user_type_accepted",
            "user_id",
            "consent_type",
            text("accepted_at DESC"),
        ),
    )


# ---------------------------------------------------------------------------
# voice_feedbacks / feedback_notifications (H09AAPPLE-33)
# ---------------------------------------------------------------------------
class FeedbackClassification(str, enum.Enum):
    friction = "friction"
    question = "question"
    suggestion = "suggestion"


class FeedbackPolarity(str, enum.Enum):
    issue = "issue"
    positive = "positive"


class FeedbackSeverity(str, enum.Enum):
    high = "high"
    medium = "medium"
    low = "low"


class FeedbackReviewStatus(str, enum.Enum):
    pending = "pending"
    reviewed = "reviewed"


class VoiceFeedback(Base):
    __tablename__ = "voice_feedbacks"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    tenant_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    employee_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    sop_id = Column(
        UUID(as_uuid=True),
        ForeignKey("sops.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    audio_object_key = Column(String(512), nullable=False)
    content_type = Column(String(128), nullable=False)
    duration_seconds = Column(Numeric(10, 3), nullable=False)
    transcript = Column(Text, nullable=False)
    language = Column(String(32))
    classification = Column(String(32), nullable=False)
    polarity = Column(String(32), nullable=False)
    severity = Column(String(16), nullable=False)
    status = Column(
        String(32),
        nullable=False,
        server_default=FeedbackReviewStatus.pending.value,
    )
    reviewer_comment = Column(Text)
    reviewer_tags = Column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    reviewed_by = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    reviewed_at = Column(DateTime(timezone=True))
    recorded_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    notifications = relationship(
        "FeedbackNotification",
        back_populates="feedback",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        CheckConstraint(
            f"classification IN ({_csv(FeedbackClassification)})",
            name="ck_voice_feedbacks_classification",
        ),
        CheckConstraint(
            f"polarity IN ({_csv(FeedbackPolarity)})",
            name="ck_voice_feedbacks_polarity",
        ),
        CheckConstraint(
            f"severity IN ({_csv(FeedbackSeverity)})",
            name="ck_voice_feedbacks_severity",
        ),
        CheckConstraint(
            f"status IN ({_csv(FeedbackReviewStatus)})",
            name="ck_voice_feedbacks_status",
        ),
        CheckConstraint(
            "duration_seconds >= 0",
            name="ck_voice_feedbacks_duration_nonneg",
        ),
        CheckConstraint(
            "jsonb_typeof(reviewer_tags) = 'array'",
            name="ck_voice_feedbacks_reviewer_tags_array",
        ),
        Index("ix_voice_feedbacks_tenant_severity", "tenant_id", "severity"),
        Index("ix_voice_feedbacks_tenant_status", "tenant_id", "status"),
        Index("ix_voice_feedbacks_employee_sop", "employee_id", "sop_id"),
    )


class FeedbackNotification(Base):
    __tablename__ = "feedback_notifications"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    tenant_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    recipient_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    feedback_id = Column(
        UUID(as_uuid=True),
        ForeignKey("voice_feedbacks.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    event_type = Column(String(64), nullable=False)
    title = Column(String(300), nullable=False)
    body = Column(Text, nullable=False)
    delivered_via = Column(String(32), nullable=False, server_default="inbox")
    read_at = Column(DateTime(timezone=True))
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    feedback = relationship("VoiceFeedback", back_populates="notifications")

    __table_args__ = (
        Index(
            "ix_feedback_notifications_recipient_unread",
            "recipient_id",
            "read_at",
            "created_at",
        ),
    )


# ---------------------------------------------------------------------------
# walkthrough_completions (H09AAPPLE-30)
# ---------------------------------------------------------------------------
class WalkthroughCompletion(Base):
    __tablename__ = "walkthrough_completions"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    tenant_id = Column(
        UUID(as_uuid=True),
        nullable=False,
        index=True,
    )
    sop_id = Column(
        UUID(as_uuid=True),
        ForeignKey("sops.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    employee_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    completed_at = Column(
        DateTime(timezone=True),
        nullable=False,
    )
    duration_seconds = Column(
        Integer,
        nullable=False,
    )
    step_sequence = Column(
        JSONB,
        nullable=False,
        default=list,
        server_default=text("'[]'::jsonb"),
    )
    user_role = Column(
        String(32),
        nullable=False,
        server_default=UserRole.employee.value,
    )
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    friction_events = relationship(
        "WalkthroughFrictionEvent",
        back_populates="completion",
        cascade="all, delete-orphan",
    )
    step_timings = relationship(
        "WalkthroughStepTiming",
        back_populates="completion",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        CheckConstraint(
            "duration_seconds >= 0",
            name="ck_walkthrough_completion_duration_nonneg",
        ),
        CheckConstraint(
            "jsonb_typeof(step_sequence) = 'array'",
            name="ck_walkthrough_completion_step_sequence_array",
        ),
        CheckConstraint(
            f"user_role IN ({_csv(UserRole)})",
            name="ck_walkthrough_completion_user_role",
        ),
        Index(
            "ix_walkthrough_completion_sop_employee",
            "sop_id",
            "employee_id",
        ),
    )


# ---------------------------------------------------------------------------
# walkthrough_friction_events (H09AAPPLE-30)
# ---------------------------------------------------------------------------
class WalkthroughFrictionEvent(Base):
    __tablename__ = "walkthrough_friction_events"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    completion_id = Column(
        UUID(as_uuid=True),
        ForeignKey("walkthrough_completions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    step_number = Column(
        Integer,
        nullable=False,
    )
    event_type = Column(
        String(32),
        nullable=False,
    )
    occurred_at = Column(
        DateTime(timezone=True),
        nullable=False,
    )

    completion = relationship(
        "WalkthroughCompletion",
        back_populates="friction_events",
    )

    __table_args__ = (
        CheckConstraint(
            "step_number >= 1",
            name="ck_walkthrough_friction_step_number_pos",
        ),
        CheckConstraint(
            f"event_type IN ({_csv(WalkthroughFrictionType)})",
            name="ck_walkthrough_friction_event_type",
        ),
        Index(
            "ix_walkthrough_friction_completion_step",
            "completion_id",
            "step_number",
        ),
    )


# ---------------------------------------------------------------------------
# walkthrough_step_timings (H09AAPPLE-30)
# ---------------------------------------------------------------------------
class WalkthroughStepTiming(Base):
    __tablename__ = "walkthrough_step_timings"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    completion_id = Column(
        UUID(as_uuid=True),
        ForeignKey("walkthrough_completions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    step_number = Column(
        Integer,
        nullable=False,
    )
    duration_ms = Column(
        Integer,
        nullable=False,
    )

    completion = relationship(
        "WalkthroughCompletion",
        back_populates="step_timings",
    )

    __table_args__ = (
        CheckConstraint(
            "step_number >= 1",
            name="ck_walkthrough_step_timing_step_number_pos",
        ),
        CheckConstraint(
            "duration_ms >= 0",
            name="ck_walkthrough_step_timing_duration_nonneg",
        ),
        UniqueConstraint(
            "completion_id",
            "step_number",
            name="uq_walkthrough_step_timing_completion_step",
        ),
        Index(
            "ix_walkthrough_step_timing_completion",
            "completion_id",
        ),
    )


class FrictionAnalysisStatus(str, enum.Enum):
    pending = "pending"
    processing = "processing"
    completed = "completed"
    failed = "failed"


class FrictionAnalysis(Base):
    """One publish-triggered friction calculation run for an SOP."""

    __tablename__ = "friction_analysis"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    tenant_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    sop_id = Column(
        UUID(as_uuid=True),
        ForeignKey("sops.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    status = Column(
        String(32),
        nullable=False,
        server_default=FrictionAnalysisStatus.pending.value,
    )
    overall_score = Column(Numeric(6, 2))
    highest_friction_step = Column(Integer)
    employee_count = Column(Integer, nullable=False, server_default="0")
    algorithm_version = Column(String(64), nullable=False, server_default="friction-v1")
    error_message = Column(Text)
    triggered_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    started_at = Column(DateTime(timezone=True))
    completed_at = Column(DateTime(timezone=True))

    employee_step_scores = relationship(
        "FrictionEmployeeStepScore",
        back_populates="analysis",
        cascade="all, delete-orphan",
    )
    step_aggregates = relationship(
        "FrictionStepAggregate",
        back_populates="analysis",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        CheckConstraint(
            f"status IN ({_csv(FrictionAnalysisStatus)})",
            name="ck_friction_analysis_status",
        ),
        CheckConstraint(
            "overall_score IS NULL OR (overall_score >= 0 AND overall_score <= 100)",
            name="ck_friction_analysis_overall_score",
        ),
        CheckConstraint(
            "highest_friction_step IS NULL OR highest_friction_step >= 1",
            name="ck_friction_analysis_highest_step",
        ),
        CheckConstraint("employee_count >= 0", name="ck_friction_analysis_employee_count"),
        Index(
            "ix_friction_analysis_tenant_sop_triggered",
            "tenant_id",
            "sop_id",
            text("triggered_at DESC"),
        ),
    )


class FrictionEmployeeStepScore(Base):
    """Calculated 0-100 score for one employee and one SOP step."""

    __tablename__ = "friction_employee_step_scores"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    analysis_id = Column(
        UUID(as_uuid=True),
        ForeignKey("friction_analysis.id", ondelete="CASCADE"),
        nullable=False,
    )
    employee_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    completion_id = Column(
        UUID(as_uuid=True),
        ForeignKey("walkthrough_completions.id", ondelete="CASCADE"),
        nullable=False,
    )
    step_number = Column(Integer, nullable=False)
    duration_ms = Column(Integer, nullable=False)
    expected_duration_ms = Column(Integer, nullable=False)
    retry_count = Column(Integer, nullable=False, server_default="0")
    path_deviation_count = Column(Integer, nullable=False, server_default="0")
    score = Column(Numeric(6, 2), nullable=False)
    is_outlier = Column(Boolean, nullable=False, server_default=text("false"))

    analysis = relationship("FrictionAnalysis", back_populates="employee_step_scores")

    __table_args__ = (
        UniqueConstraint(
            "analysis_id",
            "employee_id",
            "step_number",
            name="uq_friction_score_analysis_employee_step",
        ),
        CheckConstraint("step_number >= 1", name="ck_friction_score_step_number"),
        CheckConstraint("duration_ms >= 0", name="ck_friction_score_duration"),
        CheckConstraint("expected_duration_ms > 0", name="ck_friction_score_expected_duration"),
        CheckConstraint("retry_count >= 0", name="ck_friction_score_retries"),
        CheckConstraint(
            "path_deviation_count >= 0",
            name="ck_friction_score_path_deviations",
        ),
        CheckConstraint(
            "score >= 0 AND score <= 100",
            name="ck_friction_score_range",
        ),
        Index(
            "ix_friction_scores_analysis_step",
            "analysis_id",
            "step_number",
        ),
        Index(
            "ix_friction_scores_analysis_employee",
            "analysis_id",
            "employee_id",
        ),
    )


class FrictionStepAggregate(Base):
    """Best/worst and aggregate score for one step in an analysis run."""

    __tablename__ = "friction_step_aggregates"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    analysis_id = Column(
        UUID(as_uuid=True),
        ForeignKey("friction_analysis.id", ondelete="CASCADE"),
        nullable=False,
    )
    step_number = Column(Integer, nullable=False)
    average_score = Column(Numeric(6, 2), nullable=False)
    min_score = Column(Numeric(6, 2), nullable=False)
    max_score = Column(Numeric(6, 2), nullable=False)
    best_employee_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
    )
    worst_employee_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
    )
    sample_size = Column(Integer, nullable=False)

    analysis = relationship("FrictionAnalysis", back_populates="step_aggregates")

    __table_args__ = (
        UniqueConstraint(
            "analysis_id",
            "step_number",
            name="uq_friction_aggregate_analysis_step",
        ),
        CheckConstraint("step_number >= 1", name="ck_friction_aggregate_step_number"),
        CheckConstraint(
            "average_score >= 0 AND average_score <= 100",
            name="ck_friction_aggregate_average",
        ),
        CheckConstraint(
            "min_score >= 0 AND min_score <= 100",
            name="ck_friction_aggregate_min",
        ),
        CheckConstraint(
            "max_score >= 0 AND max_score <= 100",
            name="ck_friction_aggregate_max",
        ),
        CheckConstraint(
            "min_score <= average_score AND average_score <= max_score",
            name="ck_friction_aggregate_order",
        ),
        CheckConstraint("sample_size >= 1", name="ck_friction_aggregate_sample_size"),
        Index("ix_friction_aggregates_analysis", "analysis_id"),
    )


__all__ = [
    "Base",
    "ConsentAcceptance",
    "ConsentType",
    "Event",
    "EventType",
    "Screenshot",
    "Session",
    "SessionStatus",
    "Sop",
    "SopStepEmbedding",
    "SopStatus",
    "CodificationJob",
    "CodificationJobStatus",
    "ClusteringResult",
    "User",
    "UserRole",
    "RefreshToken",
    "PasswordResetToken",
    "LlmAuditLog",
    "WalkthroughCompletion",
    "WalkthroughFrictionEvent",
    "WalkthroughStepTiming",
    "WalkthroughFrictionType",
    "WorkflowCluster",
    "WorkflowStepVariance",
    "FrictionAnalysis",
    "FrictionAnalysisStatus",
    "FrictionEmployeeStepScore",
    "FrictionStepAggregate",
    "FeedbackClassification",
    "FeedbackPolarity",
    "FeedbackSeverity",
    "FeedbackReviewStatus",
    "VoiceFeedback",
    "FeedbackNotification",
]
