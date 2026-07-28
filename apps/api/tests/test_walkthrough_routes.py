from __future__ import annotations

from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from app import models
from app.auth.deps import get_current_user
from app.database import get_db
from app.main import app
from app.models import (
    UserRole,
    WalkthroughCompletion,
    WalkthroughFrictionEvent,
    WalkthroughStepTiming,
)

client = TestClient(app)

USER_ID = UUID("11111111-1111-1111-1111-111111111111")
TENANT_ID = UUID("22222222-2222-2222-2222-222222222222")
SOP_ID = UUID("33333333-3333-3333-3333-333333333333")


def _make_user(role: UserRole = UserRole.employee):
    return SimpleNamespace(
        id=USER_ID,
        email="employee@example.com",
        role=role.value,
        tenant_id=TENANT_ID,
    )


def _matches_criterion(item, criterion) -> bool:
    left_key = criterion.left.key
    right = criterion.right
    value = right.value if hasattr(right, "value") else right
    return getattr(item, left_key) == value


class SopQuery:
    def __init__(self, rows):
        self._rows = rows
        self._criteria = []

    def filter(self, *criteria):
        self._criteria.extend(criteria)
        return self

    def first(self):
        matched = [
            row
            for row in self._rows
            if all(_matches_criterion(row, criterion) for criterion in self._criteria)
        ]
        return matched[0] if matched else None


class WalkthroughFakeDb:
    def __init__(self):
        self.sops = []

        self.completions: list[WalkthroughCompletion] = []
        self.friction_events: list[WalkthroughFrictionEvent] = []
        self.step_timings: list[WalkthroughStepTiming] = []

        self.pending = []

        self.flushed = False
        self.committed = False
        self.rolled_back = False

    def query(self, model):
        if model is models.Sop:
            return SopQuery(self.sops)
        return SopQuery([])

    def add(self, item):
        self.pending.append(item)

    def flush(self):
        self.flushed = True

        for row in self.pending:
            if getattr(row, "id", None) is None:
                row.id = uuid4()

    def commit(self):
        for row in self.pending:
            if isinstance(row, WalkthroughCompletion):
                self.completions.append(row)

            elif isinstance(row, WalkthroughFrictionEvent):
                self.friction_events.append(row)

            elif isinstance(row, WalkthroughStepTiming):
                self.step_timings.append(row)

        self.pending.clear()
        self.committed = True

    def rollback(self):
        self.rolled_back = True

    def refresh(self, obj):
        pass


@pytest.fixture
def walkthrough_db():
    db = WalkthroughFakeDb()

    previous_db = app.dependency_overrides.get(get_db)
    previous_user = app.dependency_overrides.get(get_current_user)

    def _override_db():
        yield db

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_current_user] = lambda: _make_user()

    yield db

    if previous_db is not None:
        app.dependency_overrides[get_db] = previous_db
    else:
        app.dependency_overrides.pop(get_db, None)

    if previous_user is not None:
        app.dependency_overrides[get_current_user] = previous_user
    else:
        app.dependency_overrides.pop(get_current_user, None)


def add_sop(db, steps=None):
    sop = models.Sop(
        id=SOP_ID,
        tenant_id=TENANT_ID,
        title="Test SOP",
        session_id=uuid4(),
        status=models.SopStatus.published.value,
        steps=steps if steps is not None else [{"order": 1}, {"order": 2}, {"order": 3}],
        warnings=[],
    )
    db.sops.append(sop)
    return sop


def valid_payload():
    return {
        "sop_id": str(SOP_ID),
        "completed_at": "2026-07-15T10:25:31Z",
        "duration_seconds": 142,
        "step_sequence": [1, 2, 1, 2, 3],
        "friction_events": [
            {
                "step_number": 2,
                "event_type": "selector_miss",
                "occurred_at": "2026-07-15T10:24:02Z",
            }
        ],
        "step_timings": [
            {
                "step_number": 1,
                "duration_ms": 3200,
            },
            {
                "step_number": 2,
                "duration_ms": 6100,
            },
        ],
    }


def test_complete_requires_auth(walkthrough_db):
    add_sop(walkthrough_db)

    app.dependency_overrides.pop(get_current_user, None)

    response = client.post(
        "/api/v1/walkthroughs/complete",
        json=valid_payload(),
    )

    assert response.status_code == 401


def test_complete_returns_404_when_sop_missing(walkthrough_db):
    response = client.post(
        "/api/v1/walkthroughs/complete",
        json=valid_payload(),
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "SOP not found"


def test_complete_creates_completion(walkthrough_db):
    add_sop(walkthrough_db)

    response = client.post(
        "/api/v1/walkthroughs/complete",
        json=valid_payload(),
    )

    assert response.status_code == 201

    body = response.json()

    assert body["completion_id"]

    assert walkthrough_db.flushed is True
    assert walkthrough_db.committed is True
    assert walkthrough_db.rolled_back is False

    assert len(walkthrough_db.completions) == 1

    completion = walkthrough_db.completions[0]

    assert completion.sop_id == SOP_ID
    assert completion.employee_id == USER_ID
    assert completion.tenant_id == TENANT_ID
    assert completion.duration_seconds == 142
    assert completion.step_sequence == [1, 2, 1, 2, 3]
    assert completion.user_role == UserRole.employee.value


def test_complete_snapshots_current_user_role(walkthrough_db):
    add_sop(walkthrough_db)
    app.dependency_overrides[get_current_user] = lambda: _make_user(UserRole.manager)

    response = client.post("/api/v1/walkthroughs/complete", json=valid_payload())

    assert response.status_code == 201
    assert walkthrough_db.completions[0].user_role == UserRole.manager.value


def test_complete_rejects_invalid_step_sequence(walkthrough_db):
    add_sop(walkthrough_db)
    payload = valid_payload()
    payload["step_sequence"] = [1, 0, 2]

    response = client.post("/api/v1/walkthroughs/complete", json=payload)

    assert response.status_code == 422


def test_complete_rejects_sequence_step_not_in_non_contiguous_sop(walkthrough_db):
    add_sop(walkthrough_db, steps=[{"order": 10}, {"order": 30}, {"title": "fallback"}])
    payload = valid_payload()
    payload["step_sequence"] = [10, 2, 30]

    response = client.post("/api/v1/walkthroughs/complete", json=payload)

    assert response.status_code == 422
    assert response.json()["detail"] == "step_sequence contains steps not in SOP: [2]"


def test_complete_accepts_explicit_and_index_fallback_step_numbers(walkthrough_db):
    add_sop(walkthrough_db, steps=[{"order": 10}, {"title": "fallback"}, {"order": 30}])
    payload = valid_payload()
    payload["step_sequence"] = [10, 2, 30]

    response = client.post("/api/v1/walkthroughs/complete", json=payload)

    assert response.status_code == 201


def test_complete_rejects_step_sequence_over_length_limit(walkthrough_db):
    add_sop(walkthrough_db)
    payload = valid_payload()
    payload["step_sequence"] = [1] * 10_001

    response = client.post("/api/v1/walkthroughs/complete", json=payload)

    assert response.status_code == 422


def test_complete_persists_friction_events(walkthrough_db):
    add_sop(walkthrough_db)

    response = client.post(
        "/api/v1/walkthroughs/complete",
        json=valid_payload(),
    )

    assert response.status_code == 201

    assert len(walkthrough_db.friction_events) == 1

    event = walkthrough_db.friction_events[0]

    assert event.step_number == 2
    assert event.event_type == "selector_miss"


def test_complete_persists_step_timings(walkthrough_db):
    add_sop(walkthrough_db)

    response = client.post(
        "/api/v1/walkthroughs/complete",
        json=valid_payload(),
    )

    assert response.status_code == 201

    assert len(walkthrough_db.step_timings) == 2

    assert walkthrough_db.step_timings[0].step_number == 1
    assert walkthrough_db.step_timings[0].duration_ms == 3200

    assert walkthrough_db.step_timings[1].step_number == 2
    assert walkthrough_db.step_timings[1].duration_ms == 6100
