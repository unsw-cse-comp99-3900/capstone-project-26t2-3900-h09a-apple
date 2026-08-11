from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from fastapi.testclient import TestClient

from app.auth.deps import get_current_user
from app.database import get_db
from app.friction_routes import _analysis_response, _workflow_summary
from app.main import app
from app.models import (
    FrictionAnalysis,
    FrictionAnalysisStatus,
    FrictionEmployeeStepScore,
    FrictionStepAggregate,
    Sop,
    SopStatus,
    User,
    UserRole,
)


class _Query:
    def __init__(self, rows):
        self.rows = list(rows)

    def filter(self, *a, **k):
        return self

    def order_by(self, *a, **k):
        return self

    def distinct(self):
        return self

    def all(self):
        return self.rows

    def first(self):
        return self.rows[0] if self.rows else None

    def one_or_none(self):
        return self.first()


def test_workflow_summary_none_and_failed():
    sop = Sop(
        id=uuid4(),
        title="A",
        status=SopStatus.published.value,
        steps=[{"order": 1, "title": "One"}],
    )
    empty = _workflow_summary(_Query([]), sop, None)
    assert empty.status is None
    assert empty.session_count == 0
    assert empty.insight_status == "pending"

    failed = FrictionAnalysis(
        id=uuid4(),
        sop_id=sop.id,
        status=FrictionAnalysisStatus.failed.value,
        employee_count=0,
        algorithm_version="friction-v1",
        triggered_at=datetime.now(UTC),
    )

    class _Db:
        def query(self, model):
            return _Query([])

    summary = _workflow_summary(_Db(), sop, failed)
    assert summary.insight_status == "failed"


def test_list_friction_workflows_ranks_published():
    manager = User(
        id=uuid4(),
        email="m@example.com",
        hashed_password="x",
        role=UserRole.manager.value,
        tenant_id=uuid4(),
    )
    sop_a = Sop(
        id=uuid4(),
        tenant_id=manager.tenant_id,
        title="Alpha",
        status=SopStatus.published.value,
        steps=[{"order": 1, "title": "One"}],
    )
    sop_b = Sop(
        id=uuid4(),
        tenant_id=manager.tenant_id,
        title="Beta",
        status=SopStatus.published.value,
        steps=[{"order": 1, "title": "One"}],
    )
    analysis = FrictionAnalysis(
        id=uuid4(),
        tenant_id=manager.tenant_id,
        sop_id=sop_a.id,
        status=FrictionAnalysisStatus.completed.value,
        overall_score=70,
        highest_friction_step=1,
        employee_count=2,
        algorithm_version="friction-v1",
        triggered_at=datetime.now(UTC),
    )

    class _Db:
        def query(self, model):
            if model is Sop:
                return _Query([sop_a, sop_b])
            if model is FrictionAnalysis:
                return _Query([analysis])
            return _Query([])

    previous_user = app.dependency_overrides.get(get_current_user)
    previous_db = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_current_user] = lambda: manager
    app.dependency_overrides[get_db] = lambda: _Db()
    try:
        response = TestClient(app).get("/api/v1/analytics/friction")
    finally:
        if previous_user is None:
            app.dependency_overrides.pop(get_current_user, None)
        else:
            app.dependency_overrides[get_current_user] = previous_user
        if previous_db is None:
            app.dependency_overrides.pop(get_db, None)
        else:
            app.dependency_overrides[get_db] = previous_db

    assert response.status_code == 200, response.text
    workflows = response.json()["workflows"]
    assert len(workflows) == 2
    assert workflows[0]["title"] == "Alpha"
    assert workflows[0]["overall_score"] == 70


def test_get_latest_friction_analysis_and_404s():
    manager = User(
        id=uuid4(),
        email="m@example.com",
        hashed_password="x",
        role=UserRole.manager.value,
        tenant_id=uuid4(),
    )
    employee = User(
        id=uuid4(),
        email="e@example.com",
        hashed_password="x",
        role=UserRole.employee.value,
        tenant_id=manager.tenant_id,
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
        employee_count=1,
        algorithm_version="friction-v1",
        triggered_at=datetime.now(UTC),
    )
    score = FrictionEmployeeStepScore(
        id=uuid4(),
        analysis_id=analysis.id,
        employee_id=employee.id,
        completion_id=uuid4(),
        step_number=1,
        duration_ms=1000,
        expected_duration_ms=800,
        retry_count=0,
        path_deviation_count=0,
        score=55,
        is_outlier=False,
    )
    aggregate = FrictionStepAggregate(
        id=uuid4(),
        analysis_id=analysis.id,
        step_number=1,
        average_score=55,
        min_score=55,
        max_score=55,
        best_employee_id=employee.id,
        worst_employee_id=employee.id,
        sample_size=1,
    )

    class _OkDb:
        def query(self, model):
            if model is Sop:
                return _Query([sop])
            if model is FrictionAnalysis:
                return _Query([analysis])
            if model is FrictionEmployeeStepScore:
                return _Query([score])
            if model is FrictionStepAggregate:
                return _Query([aggregate])
            if model is User:
                return _Query([employee])
            return _Query([])

    class _NoSopDb:
        def query(self, model):
            return _Query([])

    class _NoAnalysisDb:
        def query(self, model):
            if model is Sop:
                return _Query([sop])
            return _Query([])

    previous_user = app.dependency_overrides.get(get_current_user)
    previous_db = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_current_user] = lambda: manager

    app.dependency_overrides[get_db] = lambda: _OkDb()
    try:
        ok = TestClient(app).get(f"/api/v1/analytics/friction/{sop.id}")
    finally:
        pass
    assert ok.status_code == 200, ok.text
    body = ok.json()
    assert body["overall_score"] == 55
    assert body["employees"][0]["employee_email"] == "e@example.com"

    app.dependency_overrides[get_db] = lambda: _NoSopDb()
    try:
        missing_sop = TestClient(app).get(f"/api/v1/analytics/friction/{uuid4()}")
    finally:
        pass
    assert missing_sop.status_code == 404

    app.dependency_overrides[get_db] = lambda: _NoAnalysisDb()
    try:
        missing_analysis = TestClient(app).get(f"/api/v1/analytics/friction/{sop.id}")
    finally:
        if previous_user is None:
            app.dependency_overrides.pop(get_current_user, None)
        else:
            app.dependency_overrides[get_current_user] = previous_user
        if previous_db is None:
            app.dependency_overrides.pop(get_db, None)
        else:
            app.dependency_overrides[get_db] = previous_db
    assert missing_analysis.status_code == 404


def test_analysis_response_helper_builds_employees():
    sop = Sop(
        id=uuid4(),
        title="X",
        steps=[{"order": 1, "title": "One"}],
    )
    analysis = FrictionAnalysis(
        id=uuid4(),
        sop_id=sop.id,
        status=FrictionAnalysisStatus.completed.value,
        overall_score=10,
        employee_count=1,
        algorithm_version="friction-v1",
        triggered_at=datetime.now(UTC),
    )
    emp_id = uuid4()
    score = FrictionEmployeeStepScore(
        id=uuid4(),
        analysis_id=analysis.id,
        employee_id=emp_id,
        completion_id=uuid4(),
        step_number=1,
        duration_ms=1,
        expected_duration_ms=1,
        retry_count=0,
        path_deviation_count=0,
        score=10,
        is_outlier=False,
    )

    class _Db:
        def query(self, model):
            if model is FrictionEmployeeStepScore:
                return _Query([score])
            if model is FrictionStepAggregate:
                return _Query([])
            if model is User:
                return _Query([])
            return _Query([])

    response = _analysis_response(_Db(), analysis, sop)
    assert response.employees[0].employee_id == emp_id
    assert response.employee_step_scores[0].score == 10.0
