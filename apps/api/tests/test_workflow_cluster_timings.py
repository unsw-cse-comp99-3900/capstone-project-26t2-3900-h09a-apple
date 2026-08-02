from datetime import UTC, datetime
from uuid import uuid4

from fastapi.testclient import TestClient

from app.auth.deps import get_current_user
from app.database import get_db
from app.main import app
from app.models import (
    Session,
    SessionStatus,
    Sop,
    SopStatus,
    User,
    UserRole,
    WalkthroughCompletion,
    WalkthroughStepTiming,
    WorkflowCluster,
)
from app.workflow_cluster_timings import build_cluster_timings_response


def test_build_cluster_timings_picks_lowest_total_as_best():
    tenant_id = uuid4()
    workflow_id = uuid4()
    session_a = uuid4()
    session_b = uuid4()
    sop_a = uuid4()
    sop_b = uuid4()
    completion_a = uuid4()
    completion_b = uuid4()

    clusters = [
        WorkflowCluster(
            id=uuid4(),
            tenant_id=tenant_id,
            workflow_name="onboarding",
            run_id=uuid4(),
            cluster_id=0,
            chosen_k=2,
            chosen_silhouette=0.5,
            candidate_silhouettes={"2": 0.5},
            centroid_vector=[0.0] * 1536,
            member_session_ids=[str(session_a)],
            high_variance_session_ids=[],
        ),
        WorkflowCluster(
            id=uuid4(),
            tenant_id=tenant_id,
            workflow_name="onboarding",
            run_id=uuid4(),
            cluster_id=1,
            chosen_k=2,
            chosen_silhouette=0.5,
            candidate_silhouettes={"2": 0.5},
            centroid_vector=[0.0] * 1536,
            member_session_ids=[str(session_b)],
            high_variance_session_ids=[],
        ),
    ]
    sops = [
        Sop(
            id=sop_a,
            session_id=session_a,
            tenant_id=tenant_id,
            title="A",
            status=SopStatus.published.value,
            steps=[],
        ),
        Sop(
            id=sop_b,
            session_id=session_b,
            tenant_id=tenant_id,
            title="B",
            status=SopStatus.published.value,
            steps=[],
        ),
    ]
    completions = [
        WalkthroughCompletion(
            id=completion_a,
            tenant_id=tenant_id,
            sop_id=sop_a,
            employee_id=uuid4(),
            completed_at=datetime.now(UTC),
            duration_seconds=10,
        ),
        WalkthroughCompletion(
            id=completion_b,
            tenant_id=tenant_id,
            sop_id=sop_b,
            employee_id=uuid4(),
            completed_at=datetime.now(UTC),
            duration_seconds=20,
        ),
    ]
    timings = [
        WalkthroughStepTiming(
            id=uuid4(),
            completion_id=completion_a,
            step_number=1,
            duration_ms=1000,
        ),
        WalkthroughStepTiming(
            id=uuid4(),
            completion_id=completion_a,
            step_number=2,
            duration_ms=2000,
        ),
        WalkthroughStepTiming(
            id=uuid4(),
            completion_id=completion_b,
            step_number=1,
            duration_ms=4000,
        ),
        WalkthroughStepTiming(
            id=uuid4(),
            completion_id=completion_b,
            step_number=2,
            duration_ms=5000,
        ),
    ]

    payload = build_cluster_timings_response(
        workflow_id=workflow_id,
        workflow_name="onboarding",
        clusters=clusters,
        sops=sops,
        completions=completions,
        timings=timings,
    )

    assert payload.best_cluster_id == 0
    assert payload.clusters[0].steps[0].mean_duration_ms == 1000
    assert payload.clusters[1].steps[0].mean_duration_ms == 4000
    assert payload.workflow_average[0].mean_duration_ms == 2500
    assert "employee" not in payload.model_dump_json()


def test_cluster_timings_endpoint_returns_means_for_manager():
    manager = User(
        id=uuid4(),
        email="manager@example.com",
        hashed_password="x",
        role=UserRole.manager.value,
        tenant_id=uuid4(),
    )
    session_id = uuid4()
    sop = Sop(
        id=uuid4(),
        tenant_id=manager.tenant_id,
        session_id=session_id,
        title="Onboarding",
        status=SopStatus.published.value,
        steps=[{"order": 1, "title": "Invite", "instruction": "Send invite"}],
    )
    recording_session = Session(
        id=session_id,
        client_session_id=uuid4(),
        tenant_id=manager.tenant_id,
        workflow_name="onboarding",
        status=SessionStatus.captured.value,
        started_at=datetime.now(UTC),
    )
    cluster = WorkflowCluster(
        id=uuid4(),
        tenant_id=manager.tenant_id,
        workflow_name="onboarding",
        run_id=uuid4(),
        cluster_id=0,
        chosen_k=2,
        chosen_silhouette=0.4,
        candidate_silhouettes={"2": 0.4},
        centroid_vector=[0.0] * 1536,
        member_session_ids=[str(session_id)],
        high_variance_session_ids=[],
    )
    completion = WalkthroughCompletion(
        id=uuid4(),
        tenant_id=manager.tenant_id,
        sop_id=sop.id,
        employee_id=uuid4(),
        completed_at=datetime.now(UTC),
        duration_seconds=12,
    )
    timing = WalkthroughStepTiming(
        id=uuid4(),
        completion_id=completion.id,
        step_number=1,
        duration_ms=1500,
    )

    class _Query:
        def __init__(self, rows):
            self.rows = list(rows)

        def filter(self, *args, **kwargs):
            return self

        def order_by(self, *args, **kwargs):
            return self

        def all(self):
            return self.rows

        def one_or_none(self):
            return self.rows[0] if self.rows else None

    class _Db:
        def query(self, model):
            if model is Sop:
                return _Query([sop])
            if model is Session:
                return _Query([recording_session])
            if model is WorkflowCluster:
                return _Query([cluster])
            if model is WalkthroughCompletion:
                return _Query([completion])
            if model is WalkthroughStepTiming:
                return _Query([timing])
            return _Query([])

    previous_user = app.dependency_overrides.get(get_current_user)
    previous_db = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_current_user] = lambda: manager
    app.dependency_overrides[get_db] = lambda: _Db()

    try:
        response = TestClient(app).get(f"/api/v1/workflows/{sop.id}/cluster-timings")
    finally:
        if previous_user is None:
            app.dependency_overrides.pop(get_current_user, None)
        else:
            app.dependency_overrides[get_current_user] = previous_user
        if previous_db is None:
            app.dependency_overrides.pop(get_db, None)
        else:
            app.dependency_overrides[get_db] = previous_db

    assert response.status_code == 200
    body = response.json()
    assert body["workflow_id"] == str(sop.id)
    assert body["best_cluster_id"] == 0
    assert body["clusters"][0]["steps"][0]["mean_duration_ms"] == 1500
    assert "employee_id" not in response.text
    assert "employee_email" not in response.text
