from datetime import UTC, datetime
from uuid import uuid4

from fastapi.testclient import TestClient

from app.auth.deps import get_current_user
from app.database import get_db
from app.friction_routes import _workflow_summary
from app.main import app
from app.models import (
    FrictionAnalysis,
    FrictionAnalysisStatus,
    FrictionStepAggregate,
    Sop,
    SopStatus,
    User,
    UserRole,
)


class _Query:
    def __init__(self, rows):
        self.rows = list(rows)

    def filter(self, *args, **kwargs):
        return self

    def order_by(self, *args, **kwargs):
        return self

    def distinct(self):
        return self

    def all(self):
        return self.rows

    def first(self):
        return self.rows[0] if self.rows else None

    def one_or_none(self):
        return self.first()


class _SummaryDb:
    def __init__(self, aggregates, outlier_steps: list[int]):
        self.aggregates = aggregates
        self.outlier_steps = outlier_steps

    def query(self, model):
        if model is FrictionStepAggregate:
            return _Query(self.aggregates)

        class _OutlierQuery:
            def __init__(self, steps):
                self.steps = steps

            def filter(self, *args, **kwargs):
                return self

            def distinct(self):
                return self

            def all(self):
                return [(step,) for step in self.steps]

        return _OutlierQuery(self.outlier_steps)


def test_workflow_summary_sets_high_variance_and_insight_teaser():
    sop = Sop(
        id=uuid4(),
        title="Expense claim",
        status=SopStatus.published.value,
        steps=[{"order": 1, "title": "Open"}, {"order": 2, "title": "Approve"}],
    )
    analysis = FrictionAnalysis(
        id=uuid4(),
        sop_id=sop.id,
        status=FrictionAnalysisStatus.completed.value,
        overall_score=81.2,
        highest_friction_step=2,
        employee_count=9,
        algorithm_version="friction-v1",
        triggered_at=datetime.now(UTC),
    )
    aggregates = [
        FrictionStepAggregate(
            id=uuid4(),
            analysis_id=analysis.id,
            step_number=1,
            average_score=60,
            min_score=50,
            max_score=70,
            sample_size=9,
        ),
        FrictionStepAggregate(
            id=uuid4(),
            analysis_id=analysis.id,
            step_number=2,
            average_score=90,
            min_score=80,
            max_score=100,
            sample_size=9,
        ),
    ]
    summary = _workflow_summary(_SummaryDb(aggregates, [2]), sop, analysis)
    assert summary.high_variance is True
    assert summary.session_count == 9
    assert summary.overall_score == 81.2
    assert summary.insight_status == "ready"
    assert summary.insight_teaser
    assert summary.insight_teaser.endswith(".")
    assert summary.steps[1].variance_flag is True
    assert not hasattr(summary, "employee_id")


def test_insight_summary_endpoint_returns_teaser_for_completed_analysis():
    manager = User(
        id=uuid4(),
        email="manager@example.com",
        hashed_password="x",
        role=UserRole.manager.value,
        tenant_id=uuid4(),
    )
    sop = Sop(
        id=uuid4(),
        tenant_id=manager.tenant_id,
        title="Onboarding",
        status=SopStatus.published.value,
        steps=[{"order": 1, "title": "Invite"}],
    )
    analysis = FrictionAnalysis(
        id=uuid4(),
        tenant_id=manager.tenant_id,
        sop_id=sop.id,
        status=FrictionAnalysisStatus.completed.value,
        overall_score=55,
        highest_friction_step=1,
        employee_count=4,
        algorithm_version="friction-v1",
        triggered_at=datetime.now(UTC),
    )

    class _Db:
        def query(self, model):
            if model is Sop:
                return _Query([sop])
            if model is FrictionAnalysis:
                return _Query([analysis])
            return _Query([])

    previous_user = app.dependency_overrides.get(get_current_user)
    previous_db = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_current_user] = lambda: manager
    app.dependency_overrides[get_db] = lambda: _Db()

    try:
        response = TestClient(app).get(f"/api/v1/workflows/{sop.id}/insight-summary")
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
    assert body["status"] == "ready"
    assert body["teaser"]
    assert "Invite" in body["summary"]
    assert "employee_id" not in response.text
