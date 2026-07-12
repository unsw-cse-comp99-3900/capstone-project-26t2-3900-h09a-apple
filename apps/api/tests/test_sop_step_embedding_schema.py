from __future__ import annotations

import os
from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.models import Sop, SopStepEmbedding

DEFAULT_TENANT_ID = UUID("22222222-2222-2222-2222-222222222222")

pytestmark = pytest.mark.skipif(
    not os.getenv("DATABASE_URL"),
    reason="DATABASE_URL required for sop_step_embedding DB integration tests",
)


def test_sop_has_no_whole_sop_embedding_column():
    assert "sop_embedding" not in Sop.__table__.columns


def test_sop_step_embedding_schema_contract():
    table = SopStepEmbedding.__table__

    assert table.name == "sop_step_embedding"
    assert table.c.sop_id.foreign_keys
    assert table.c.step_number.nullable is False
    assert table.c.embedding.type.dim == 1536

    constraints = {constraint.name for constraint in table.constraints}
    assert "uq_sop_step_embedding_sop_step" in constraints
    assert "ck_sop_step_embedding_step_number_pos" in constraints


@pytest.fixture
def db_session():
    from app.database import get_sessionmaker

    session = get_sessionmaker()()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


def test_pgvector_extension_installed(db_session):
    row = db_session.execute(
        text("SELECT extname FROM pg_extension WHERE extname = 'vector'")
    ).one()
    assert row.extname == "vector"


def test_ivfflat_cosine_index_exists(db_session):
    row = db_session.execute(
        text(
            """
            SELECT indexdef
            FROM pg_indexes
            WHERE tablename = 'sop_step_embedding'
              AND indexname = 'ix_sop_step_embedding_embedding_ivfflat'
            """
        )
    ).one()
    assert "ivfflat" in row.indexdef
    assert "vector_cosine_ops" in row.indexdef
    assert "lists='10'" in row.indexdef


def test_unique_sop_step_rejects_duplicate(db_session):
    sop_id = db_session.execute(
        text(
            """
            WITH new_session AS (
                INSERT INTO sessions (
                    client_session_id, tenant_id, workflow_name, status, started_at, event_count
                )
                VALUES (gen_random_uuid(), :tenant_id, 'embed-test', 'recording', now(), 1)
                RETURNING id
            )
            INSERT INTO sops (session_id, tenant_id, title, status, steps, warnings)
            SELECT id, :tenant_id, 'Embed test SOP', 'draft', '[]'::jsonb, '[]'::jsonb
            FROM new_session
            RETURNING id
            """
        ),
        {"tenant_id": str(DEFAULT_TENANT_ID)},
    ).scalar_one()

    zero_vector = array_fill(0.0, 1536)
    db_session.execute(
        text(
            """
            INSERT INTO sop_step_embedding (sop_id, step_number, embedding)
            VALUES (:sop_id, 1, :embedding)
            """
        ),
        {"sop_id": sop_id, "embedding": zero_vector},
    )
    db_session.commit()

    try:
        with pytest.raises(IntegrityError):
            db_session.execute(
                text(
                    """
                    INSERT INTO sop_step_embedding (sop_id, step_number, embedding)
                    VALUES (:sop_id, 1, :embedding)
                    """
                ),
                {"sop_id": sop_id, "embedding": zero_vector},
            )
            db_session.commit()
        db_session.rollback()
    finally:
        db_session.execute(
            text("DELETE FROM sops WHERE id = :sop_id"),
            {"sop_id": sop_id},
        )
        db_session.commit()


def test_step_number_zero_rejected_by_check_constraint(db_session):
    sop_id = db_session.execute(
        text(
            """
            WITH new_session AS (
                INSERT INTO sessions (
                    client_session_id, tenant_id, workflow_name, status, started_at, event_count
                )
                VALUES (gen_random_uuid(), :tenant_id, 'check-test', 'recording', now(), 1)
                RETURNING id
            )
            INSERT INTO sops (session_id, tenant_id, title, status, steps, warnings)
            SELECT id, :tenant_id, 'Check test SOP', 'draft', '[]'::jsonb, '[]'::jsonb
            FROM new_session
            RETURNING id
            """
        ),
        {"tenant_id": str(DEFAULT_TENANT_ID)},
    ).scalar_one()

    zero_vector = array_fill(0.0, 1536)

    try:
        with pytest.raises(IntegrityError):
            db_session.execute(
                text(
                    """
                    INSERT INTO sop_step_embedding (sop_id, step_number, embedding)
                    VALUES (:sop_id, 0, :embedding)
                    """
                ),
                {"sop_id": sop_id, "embedding": zero_vector},
            )
            db_session.commit()
        db_session.rollback()
    finally:
        db_session.execute(
            text("DELETE FROM sops WHERE id = :sop_id"),
            {"sop_id": sop_id},
        )
        db_session.commit()


def array_fill(value: float, dimensions: int) -> str:
    return "[" + ",".join(str(value) for _ in range(dimensions)) + "]"
