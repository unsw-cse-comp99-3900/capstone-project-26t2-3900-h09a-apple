from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from app import models
from app.auth.deps import get_current_user
from app.database import get_sessionmaker
from app.main import app
from seeds.demo_seed import seed_demo

client = TestClient(app)

TENANT_ID = UUID("22222222-2222-2222-2222-222222222222")
USER_ID = UUID("11111111-1111-1111-1111-111111111111")


def _mock_user(
    role: str = models.UserRole.manager.value,
):
    return SimpleNamespace(
        id=USER_ID,
        email="demo.manager@worktrace.local",
        role=role,
        tenant_id=TENANT_ID,
    )


@pytest.fixture(scope="module", autouse=True)
def setup_demo_environment():
    """
    Seed a deterministic demo environment before executing
    integration smoke tests.
    """

    seed_demo()

    app.dependency_overrides[get_current_user] = lambda: _mock_user(models.UserRole.manager.value)

    yield

    app.dependency_overrides.pop(get_current_user, None)


@pytest.fixture
def db_session():
    session_factory = get_sessionmaker()
    db = session_factory()

    try:
        yield db
    finally:
        db.close()


# ============================================================
# Smoke Test 1
# Demo seed integrity
# ============================================================


def test_01_seed_multi_session_integrity(db_session):
    """
    Verify demo seed created everything required for analytics.

    Expected:

    - 1 published SOP
    - completed embeddings
    - >=4 walkthrough sessions
    - >=1 friction event
    """

    sop = db_session.query(models.Sop).filter(models.Sop.tenant_id == TENANT_ID).first()

    assert sop is not None

    assert sop.status == models.SopStatus.published.value

    assert sop.embedding_status == models.EmbeddingStatus.complete.value

    completions = (
        db_session.query(models.WalkthroughCompletion)
        .filter(models.WalkthroughCompletion.sop_id == sop.id)
        .all()
    )

    assert len(completions) >= 4

    friction_events = (
        db_session.query(models.WalkthroughFrictionEvent)
        .filter(models.WalkthroughFrictionEvent.completion_id.in_([c.id for c in completions]))
        .all()
    )

    assert len(friction_events) >= 1


# ============================================================
# Smoke Test 2
# KMeans clustering
# ============================================================


def test_02_kmeans_clustering_api(db_session):
    """
    Verify seeded walkthroughs are sufficient for
    analytics clustering.

    This specifically protects against the
    H09AAPPLE-36 acceptance criterion where fewer
    than the required sessions returns HTTP 422.
    """

    sop = db_session.query(models.Sop).filter(models.Sop.tenant_id == TENANT_ID).first()

    assert sop is not None

    payload = {
        "workflow_id": str(sop.id),
        "k": 2,
        "min_sessions": 4,
    }

    response = client.post(
        "/api/v1/analytics/kmeans",
        json=payload,
    )

    assert response.status_code == 200

    body = response.json()

    assert body["workflow_id"] == str(sop.id)
    assert body["k"] == 2

    assert isinstance(body["clusters"], list)
    assert isinstance(body["assignments"], list)
    assert isinstance(body["outliers"], list)

    assert len(body["assignments"]) >= 4

    assert "metadata" in body


# ============================================================
# Smoke Test 3
# Friction Analysis
# ============================================================


def test_03_friction_analysis_api(db_session):
    """
    Verify friction analysis exists for the seeded SOP.
    """

    sop = db_session.query(models.Sop).filter(models.Sop.tenant_id == TENANT_ID).first()

    assert sop is not None

    response = client.get(f"/api/v1/analytics/friction/{sop.id}")

    assert response.status_code == 200

    body = response.json()

    assert body is not None
    assert isinstance(body, dict)
    assert len(body) > 0


# ============================================================
# Smoke Test 4
# Dashboard Summary
# ============================================================


def test_04_dashboard_summary_api():
    """
    Verify dashboard summary loads successfully.

    This validates that seeded walkthroughs and analytics
    can be surfaced through the dashboard.
    """

    app.dependency_overrides[get_current_user] = lambda: _mock_user(models.UserRole.employee.value)

    response = client.get("/api/v1/dashboard/summary")

    assert response.status_code == 200

    body = response.json()

    assert body["role"] == models.UserRole.employee.value

    assert "greeting" in body
    assert "kpis" in body
    assert "primary_items" in body

    assert isinstance(body["kpis"], list)
    assert isinstance(body["primary_items"], list)


# ============================================================
# Smoke Test 5
# Feedback APIs
# ============================================================


def test_05_feedback_api():
    """
    Verify feedback endpoints remain healthy.

    The demo seed does not generate voice feedback,
    therefore this smoke test only validates the API
    contract rather than specific seeded records.
    """

    app.dependency_overrides[get_current_user] = lambda: _mock_user(models.UserRole.manager.value)

    response = client.get("/api/v1/feedback")

    assert response.status_code == 200

    feedback_body = response.json()

    assert "feedbacks" in feedback_body
    assert isinstance(
        feedback_body["feedbacks"],
        list,
    )

    stats = client.get("/api/v1/feedback/stats")

    assert stats.status_code == 200

    stats_body = stats.json()

    assert "total" in stats_body
    assert "by_classification" in stats_body
    assert "by_severity" in stats_body
    assert "by_status" in stats_body
    assert "high_severity_open" in stats_body


# ============================================================
# Final Smoke Check
# ============================================================


def test_06_demo_environment_health(db_session):
    """
    Final verification that the seeded demo environment
    remains internally consistent.

    This guards against accidental regressions where
    seed data is partially deleted or duplicated.
    """

    sop_count = db_session.query(models.Sop).filter(models.Sop.tenant_id == TENANT_ID).count()

    completion_count = db_session.query(models.WalkthroughCompletion).count()

    friction_count = db_session.query(models.WalkthroughFrictionEvent).count()

    embedding_count = db_session.query(models.SopStepEmbedding).count()

    assert sop_count >= 1
    assert completion_count >= 4
    assert friction_count >= 1
    assert embedding_count >= 4


def test_07_health():
    response = client.get("/api/v1/health")

    assert response.status_code == 200

    body = response.json()

    assert body["status"] == "ok"


def test_08_sop_list():
    response = client.get("/api/v1/sops")

    assert response.status_code == 200

    assert len(response.json()) >= 1


def test_09_voice_transcription():
    app.dependency_overrides[get_current_user] = lambda: _mock_user(models.UserRole.employee.value)

    audio_path = Path(__file__).parent / "assets" / "demo.webm"

    assert audio_path.exists()

    with audio_path.open("rb") as audio:
        response = client.post(
            "/api/v1/feedback/transcribe",
            files={
                "audio": (
                    "demo.webm",
                    audio,
                    "audio/webm",
                )
            },
        )

    assert response.status_code == 200

    body = response.json()

    assert "transcript" in body
    assert body["transcript"] is not None

    assert "duration_seconds" in body
    assert body["duration_seconds"] >= 0
