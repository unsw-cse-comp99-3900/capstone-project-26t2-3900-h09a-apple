from datetime import UTC, datetime
from uuid import uuid4

from fastapi.testclient import TestClient

from app.auth.deps import get_current_user
from app.database import get_db
from app.friction_calculation import FrictionCalculationError
from app.main import app
from app.models import FrictionAnalysis, FrictionAnalysisStatus, Sop, SopStatus, User, UserRole


class _Query:
    def __init__(self, rows):
        self.rows = list(rows)

    def filter(self, *args, **kwargs):
        return self

    def one_or_none(self):
        return self.rows[0] if self.rows else None


class _Db:
    def __init__(self, sop):
        self.sop = sop
        self.added = []
        self.committed = False

    def query(self, model):
        if model is Sop:
            return _Query([self.sop] if self.sop is not None else [])
        return _Query([])

    def add(self, obj):
        self.added.append(obj)

    def commit(self):
        self.committed = True

    def refresh(self, obj):
        return obj


def test_recalculate_friction_runs_for_published_sop(monkeypatch):
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
        session_id=uuid4(),
        title="Expense claim",
        status=SopStatus.published.value,
        steps=[{"order": 1, "title": "Open"}],
    )
    db = _Db(sop)

    def _fake_calc(session, analysis):
        analysis.overall_score = 77.5
        analysis.employee_count = 3
        analysis.highest_friction_step = 1
        return analysis

    monkeypatch.setattr(
        "app.workflow_routes.calculate_friction_analysis",
        _fake_calc,
    )
    monkeypatch.setattr("app.workflow_routes.publish_friction_update", lambda *args, **kwargs: None)

    previous_user = app.dependency_overrides.get(get_current_user)
    previous_db = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_current_user] = lambda: manager
    app.dependency_overrides[get_db] = lambda: db

    try:
        response = TestClient(app).post(f"/api/v1/workflows/{sop.id}/friction/recalculate")
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
    assert body["status"] == FrictionAnalysisStatus.completed.value
    assert body["overall_score"] == 77.5
    assert body["employee_count"] == 3
    assert db.committed is True
    assert any(isinstance(item, FrictionAnalysis) for item in db.added)


def test_recalculate_friction_rejects_unpublished_sop():
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
        session_id=uuid4(),
        title="Draft SOP",
        status=SopStatus.approved.value,
        steps=[{"order": 1, "title": "Open"}],
        published_at=None,
    )
    db = _Db(sop)

    previous_user = app.dependency_overrides.get(get_current_user)
    previous_db = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_current_user] = lambda: manager
    app.dependency_overrides[get_db] = lambda: db

    try:
        response = TestClient(app).post(f"/api/v1/workflows/{sop.id}/friction/recalculate")
    finally:
        if previous_user is None:
            app.dependency_overrides.pop(get_current_user, None)
        else:
            app.dependency_overrides[get_current_user] = previous_user
        if previous_db is None:
            app.dependency_overrides.pop(get_db, None)
        else:
            app.dependency_overrides[get_db] = previous_db

    assert response.status_code == 422
    assert "published" in response.json()["detail"].lower()


def test_recalculate_friction_maps_calculation_errors(monkeypatch):
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
        session_id=uuid4(),
        title="Expense claim",
        status=SopStatus.published.value,
        steps=[],
        published_at=datetime.now(UTC),
    )
    db = _Db(sop)

    def _boom(session, analysis):
        raise FrictionCalculationError("SOP has no valid steps")

    monkeypatch.setattr("app.workflow_routes.calculate_friction_analysis", _boom)
    monkeypatch.setattr("app.workflow_routes.publish_friction_update", lambda *args, **kwargs: None)

    previous_user = app.dependency_overrides.get(get_current_user)
    previous_db = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_current_user] = lambda: manager
    app.dependency_overrides[get_db] = lambda: db

    try:
        response = TestClient(app).post(f"/api/v1/workflows/{sop.id}/friction/recalculate")
    finally:
        if previous_user is None:
            app.dependency_overrides.pop(get_current_user, None)
        else:
            app.dependency_overrides[get_current_user] = previous_user
        if previous_db is None:
            app.dependency_overrides.pop(get_db, None)
        else:
            app.dependency_overrides[get_db] = previous_db

    assert response.status_code == 422
    assert "no valid steps" in response.json()["detail"]
