from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from app import models
from app.auth.deps import get_current_user
from app.database import get_db
from app.main import app
from app.models import UserRole

client = TestClient(app)

USER_ID = UUID("11111111-1111-1111-1111-111111111111")
TENANT_ID = UUID("22222222-2222-2222-2222-222222222222")
SOP_ID = UUID("33333333-3333-3333-3333-333333333333")


def _make_user(role: UserRole = UserRole.reviewer):
    return SimpleNamespace(
        id=USER_ID,
        email="reviewer@example.com",
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


class EditLogQuery:
    def __init__(self, rows):
        self._rows = rows
        self._criteria = []
        self._order_desc = False
        self._limit = None

    def filter(self, *criteria):
        self._criteria.extend(criteria)
        return self

    def order_by(self, *args):
        self._order_desc = True
        return self

    def limit(self, n):
        self._limit = n
        return self

    def all(self):
        matched = [
            row
            for row in self._rows
            if all(_matches_criterion(row, criterion) for criterion in self._criteria)
        ]
        if self._order_desc:
            matched = sorted(
                matched,
                key=lambda row: row.created_at or datetime.min.replace(tzinfo=UTC),
                reverse=True,
            )
        if self._limit is not None:
            matched = matched[: self._limit]
        return matched


class SopEditFakeDb:
    def __init__(self):
        self.sops: list[models.Sop] = []
        self.edit_logs: list[models.SopStepEditLog] = []
        self.pending = []
        self.committed = False
        self.refreshed = []

    def query(self, model):
        if model is models.Sop:
            return SopQuery(self.sops)
        if model is models.SopStepEditLog:
            return EditLogQuery(self.edit_logs)
        return SopQuery([])

    def add(self, item):
        self.pending.append(item)

    def commit(self):
        for row in self.pending:
            if isinstance(row, models.SopStepEditLog):
                if getattr(row, "id", None) is None:
                    row.id = uuid4()
                if getattr(row, "created_at", None) is None:
                    row.created_at = datetime.now(UTC)
                self.edit_logs.append(row)
        self.pending.clear()
        self.committed = True

    def refresh(self, obj):
        self.refreshed.append(obj)


@pytest.fixture
def sop_edit_db():
    db = SopEditFakeDb()
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


def add_sop(db: SopEditFakeDb, steps=None, sop_id: UUID = SOP_ID, tenant_id: UUID = TENANT_ID):
    sop = models.Sop(
        id=sop_id,
        tenant_id=tenant_id,
        title="Editable SOP",
        session_id=uuid4(),
        status=models.SopStatus.published.value,
        steps=steps
        if steps is not None
        else [
            {"order": 1, "instruction": "Open the form"},
            {"order": 2, "instruction": "Click submit"},
        ],
        warnings=[],
    )
    db.sops.append(sop)
    return sop


def test_edit_sop_step_instruction_success(sop_edit_db):
    sop = add_sop(sop_edit_db)

    response = client.patch(
        f"/api/v1/sops/{SOP_ID}/steps/2",
        json={"instruction": "Press the green Submit button"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["sop_id"] == str(SOP_ID)
    assert body["step_number"] == 2
    assert body["instruction"] == "Press the green Submit button"
    assert body["edit_id"]
    assert body["edited_at"]
    assert sop.steps[1]["instruction"] == "Press the green Submit button"
    assert sop_edit_db.committed is True
    assert len(sop_edit_db.edit_logs) == 1
    log = sop_edit_db.edit_logs[0]
    assert log.before_text == "Click submit"
    assert log.after_text == "Press the green Submit button"
    assert log.editor_id == USER_ID
    assert log.step_number == 2


def test_edit_sop_step_returns_404_when_sop_missing(sop_edit_db):
    response = client.patch(
        f"/api/v1/sops/{SOP_ID}/steps/1",
        json={"instruction": "Anything"},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "SOP not found"


def test_edit_sop_step_returns_404_when_steps_empty(sop_edit_db):
    add_sop(sop_edit_db, steps=[])

    response = client.patch(
        f"/api/v1/sops/{SOP_ID}/steps/1",
        json={"instruction": "Anything"},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "SOP has no steps"


def test_edit_sop_step_rejects_bad_step_number(sop_edit_db):
    add_sop(sop_edit_db)

    response = client.patch(
        f"/api/v1/sops/{SOP_ID}/steps/0",
        json={"instruction": "Anything"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "step_number must be >= 1"


def test_edit_sop_step_rejects_unchanged_instruction(sop_edit_db):
    add_sop(sop_edit_db)

    response = client.patch(
        f"/api/v1/sops/{SOP_ID}/steps/1",
        json={"instruction": "Open the form"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "instruction is unchanged"
    assert sop_edit_db.edit_logs == []


def test_edit_sop_step_uses_order_and_positional_fallback(sop_edit_db):
    # Covers _step_index: match by order, skip non-dict, and positional fallback.
    add_sop(
        sop_edit_db,
        steps=[
            "skip-me",
            {"order": "not-an-int", "instruction": "bad order"},
            {"order": 5, "instruction": "Fifth step"},
            {"instruction": "Fourth by position"},
        ],
    )

    by_order = client.patch(
        f"/api/v1/sops/{SOP_ID}/steps/5",
        json={"instruction": "Updated fifth"},
    )
    assert by_order.status_code == 200
    assert by_order.json()["instruction"] == "Updated fifth"

    missing = client.patch(
        f"/api/v1/sops/{SOP_ID}/steps/9",
        json={"instruction": "No such step"},
    )
    assert missing.status_code == 404
    assert missing.json()["detail"] == "SOP step not found"


def test_list_sop_step_edits(sop_edit_db):
    add_sop(sop_edit_db)
    older = datetime(2026, 8, 1, 10, 0, tzinfo=UTC)
    newer = datetime(2026, 8, 2, 11, 0, tzinfo=UTC)
    sop_edit_db.edit_logs.extend(
        [
            models.SopStepEditLog(
                id=uuid4(),
                tenant_id=TENANT_ID,
                sop_id=SOP_ID,
                step_number=1,
                editor_id=USER_ID,
                before_text="old",
                after_text="mid",
                created_at=older,
            ),
            models.SopStepEditLog(
                id=uuid4(),
                tenant_id=TENANT_ID,
                sop_id=SOP_ID,
                step_number=2,
                editor_id=None,
                before_text="a",
                after_text="b",
                created_at=newer,
            ),
        ]
    )

    response = client.get(f"/api/v1/sops/{SOP_ID}/step-edits")

    assert response.status_code == 200
    body = response.json()
    assert body["sop_id"] == str(SOP_ID)
    assert len(body["edits"]) == 2
    assert body["edits"][0]["step_number"] == 2
    assert body["edits"][0]["editor_id"] is None
    assert body["edits"][0]["before_text"] == "a"
    assert body["edits"][0]["after_text"] == "b"
    assert body["edits"][1]["step_number"] == 1
    assert body["edits"][1]["editor_id"] == str(USER_ID)


def test_list_sop_step_edits_returns_404_when_sop_missing(sop_edit_db):
    response = client.get(f"/api/v1/sops/{SOP_ID}/step-edits")

    assert response.status_code == 404
    assert response.json()["detail"] == "SOP not found"
