from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import UUID

import pytest

from app import friction_tasks
from app.models import FrictionAnalysis, FrictionAnalysisStatus

ANALYSIS_ID = UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
TENANT_ID = UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
SOP_ID = UUID("cccccccc-cccc-cccc-cccc-cccccccccccc")


def _matches_criterion(item, criterion) -> bool:
    left_key = criterion.left.key
    right = criterion.right
    value = right.value if hasattr(right, "value") else right
    return getattr(item, left_key) == value


class FrictionQuery:
    def __init__(self, rows: list[FrictionAnalysis]):
        self._rows = rows
        self._criteria = []

    def filter(self, *criteria):
        self._criteria.extend(criteria)
        return self

    def one_or_none(self):
        matched = [
            row
            for row in self._rows
            if all(_matches_criterion(row, criterion) for criterion in self._criteria)
        ]
        return matched[0] if matched else None


class FakeSession:
    def __init__(self, analyses: list[FrictionAnalysis] | None = None):
        self.analyses = analyses or []
        self.committed = 0
        self.rolled_back = False
        self.closed = False
        self.refreshed = []

    def query(self, model):
        if model is FrictionAnalysis:
            return FrictionQuery(self.analyses)
        return FrictionQuery([])

    def commit(self):
        self.committed += 1

    def rollback(self):
        self.rolled_back = True

    def refresh(self, obj):
        self.refreshed.append(obj)

    def close(self):
        self.closed = True


def _make_analysis(**overrides) -> FrictionAnalysis:
    values = {
        "id": ANALYSIS_ID,
        "tenant_id": TENANT_ID,
        "sop_id": SOP_ID,
        "status": FrictionAnalysisStatus.pending.value,
        "overall_score": None,
        "highest_friction_step": None,
        "employee_count": 0,
        "error_message": None,
        "started_at": None,
        "completed_at": None,
    }
    values.update(overrides)
    return FrictionAnalysis(**values)


def test_enqueue_friction_calculation_calls_delay(monkeypatch):
    captured = {}

    monkeypatch.setattr(
        friction_tasks.calculate_friction,
        "delay",
        lambda analysis_id: captured.setdefault(
            "result", SimpleNamespace(id="task-123", analysis_id=analysis_id)
        ),
    )

    task_id = friction_tasks.enqueue_friction_calculation(ANALYSIS_ID)

    assert task_id == "task-123"
    assert captured["result"].analysis_id == str(ANALYSIS_ID)


def test_notification_serializes_nullable_fields():
    analysis = _make_analysis(
        status=FrictionAnalysisStatus.completed.value,
        overall_score=None,
        highest_friction_step=2,
        employee_count=3,
        completed_at=None,
    )

    payload = friction_tasks._notification(analysis)

    assert payload == {
        "event": "friction_analysis.updated",
        "analysis_id": str(ANALYSIS_ID),
        "sop_id": str(SOP_ID),
        "status": FrictionAnalysisStatus.completed.value,
        "overall_score": None,
        "highest_friction_step": 2,
        "employee_count": 3,
        "completed_at": None,
    }


def test_notification_includes_score_and_completed_at():
    completed_at = datetime(2026, 8, 10, 12, 0, tzinfo=UTC)
    analysis = _make_analysis(
        status=FrictionAnalysisStatus.completed.value,
        overall_score=88.5,
        highest_friction_step=1,
        employee_count=4,
        completed_at=completed_at,
    )

    payload = friction_tasks._notification(analysis)

    assert payload["overall_score"] == 88.5
    assert payload["completed_at"] == completed_at.isoformat()


def test_calculate_friction_not_found(monkeypatch):
    session = FakeSession([])
    monkeypatch.setattr(friction_tasks, "get_sessionmaker", lambda: (lambda: session))
    published = []
    monkeypatch.setattr(
        friction_tasks,
        "publish_friction_update",
        lambda *args, **kwargs: published.append((args, kwargs)),
    )

    with pytest.raises(ValueError, match="not found"):
        friction_tasks.calculate_friction.run(str(ANALYSIS_ID))

    assert session.rolled_back is True
    assert session.closed is True
    assert published == []


def test_calculate_friction_already_completed_returns_notification(monkeypatch):
    completed_at = datetime(2026, 8, 1, 9, 30, tzinfo=UTC)
    analysis = _make_analysis(
        status=FrictionAnalysisStatus.completed.value,
        overall_score=70,
        highest_friction_step=1,
        employee_count=2,
        completed_at=completed_at,
    )
    session = FakeSession([analysis])
    monkeypatch.setattr(friction_tasks, "get_sessionmaker", lambda: (lambda: session))

    calc_calls = []
    monkeypatch.setattr(
        friction_tasks,
        "calculate_friction_analysis",
        lambda *args, **kwargs: calc_calls.append((args, kwargs)),
    )
    published = []
    monkeypatch.setattr(
        friction_tasks,
        "publish_friction_update",
        lambda *args, **kwargs: published.append((args, kwargs)),
    )

    payload = friction_tasks.calculate_friction.run(str(ANALYSIS_ID))

    assert payload["status"] == FrictionAnalysisStatus.completed.value
    assert payload["overall_score"] == 70.0
    assert payload["completed_at"] == completed_at.isoformat()
    assert calc_calls == []
    assert published == []
    assert session.committed == 0
    assert session.closed is True


def test_calculate_friction_success(monkeypatch):
    analysis = _make_analysis(status=FrictionAnalysisStatus.pending.value)
    session = FakeSession([analysis])
    monkeypatch.setattr(friction_tasks, "get_sessionmaker", lambda: (lambda: session))

    def _fake_calc(db_session, current):
        assert db_session is session
        assert current is analysis
        current.overall_score = 91.25
        current.highest_friction_step = 3
        current.employee_count = 5

    monkeypatch.setattr(friction_tasks, "calculate_friction_analysis", _fake_calc)

    published = []
    monkeypatch.setattr(
        friction_tasks,
        "publish_friction_update",
        lambda tenant_id, payload: published.append((tenant_id, payload)),
    )

    payload = friction_tasks.calculate_friction.run(str(ANALYSIS_ID))

    assert analysis.status == FrictionAnalysisStatus.completed.value
    assert analysis.started_at is not None
    assert analysis.completed_at is not None
    assert analysis.error_message is None
    assert analysis in session.refreshed
    assert session.committed >= 2
    assert session.closed is True
    assert published == [(TENANT_ID, payload)]
    assert payload["status"] == FrictionAnalysisStatus.completed.value
    assert payload["overall_score"] == 91.25
    assert payload["highest_friction_step"] == 3
    assert payload["employee_count"] == 5


def test_calculate_friction_failure_marks_failed_and_publishes(monkeypatch):
    analysis = _make_analysis(status=FrictionAnalysisStatus.pending.value)
    session = FakeSession([analysis])
    monkeypatch.setattr(friction_tasks, "get_sessionmaker", lambda: (lambda: session))

    def _boom(db_session, current):
        raise RuntimeError("calc exploded")

    monkeypatch.setattr(friction_tasks, "calculate_friction_analysis", _boom)

    published = []
    monkeypatch.setattr(
        friction_tasks,
        "publish_friction_update",
        lambda tenant_id, payload: published.append((tenant_id, payload)),
    )

    with pytest.raises(RuntimeError, match="calc exploded"):
        friction_tasks.calculate_friction.run(str(ANALYSIS_ID))

    assert session.rolled_back is True
    assert analysis.status == FrictionAnalysisStatus.failed.value
    assert analysis.error_message == "calc exploded"
    assert analysis.completed_at is not None
    assert session.closed is True
    assert len(published) == 1
    assert published[0][0] == TENANT_ID
    assert published[0][1]["status"] == FrictionAnalysisStatus.failed.value
    assert published[0][1]["analysis_id"] == str(ANALYSIS_ID)
