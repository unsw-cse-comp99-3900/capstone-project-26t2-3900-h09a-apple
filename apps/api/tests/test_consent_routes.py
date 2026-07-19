from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from app.auth.deps import get_current_user
from app.consent_constants import CURRENT_CONSENT_TERMS_VERSION
from app.database import get_db
from app.main import app
from app.models import ConsentAcceptance, ConsentType, UserRole

client = TestClient(app)

USER_ID = UUID("11111111-1111-1111-1111-111111111111")
TENANT_ID = UUID("22222222-2222-2222-2222-222222222222")


def _make_user(role: UserRole = UserRole.employee):
    return SimpleNamespace(
        id=USER_ID,
        email="employee@example.com",
        role=role.value,
        tenant_id=TENANT_ID,
    )


def _matches_criterion(item: ConsentAcceptance, criterion) -> bool:
    left_key = criterion.left.key
    right = criterion.right
    value = right.value if hasattr(right, "value") else right
    return getattr(item, left_key) == value


class ConsentQuery:
    def __init__(self, rows: list[ConsentAcceptance]):
        self._rows = rows
        self._criteria: list = []
        self._order_desc = False

    def filter(self, *criteria):
        self._criteria.extend(criteria)
        return self

    def order_by(self, *args):
        self._order_desc = True
        return self

    def first(self):
        matched = [
            row
            for row in self._rows
            if all(_matches_criterion(row, criterion) for criterion in self._criteria)
        ]
        if not matched:
            return None
        if self._order_desc:
            matched = sorted(matched, key=lambda row: row.accepted_at, reverse=True)
        return matched[0]


class ConsentFakeDb:
    def __init__(self):
        self.rows: list[ConsentAcceptance] = []
        self.pending: list[ConsentAcceptance] = []
        self.committed = False

    def query(self, model):
        if model is ConsentAcceptance:
            return ConsentQuery(self.rows)
        return ConsentQuery([])

    def add(self, item):
        self.pending.append(item)

    def commit(self):
        for row in self.pending:
            if row.id is None:
                row.id = uuid4()
            self.rows.append(row)
        self.pending.clear()
        self.committed = True


@pytest.fixture
def consent_db():
    db = ConsentFakeDb()
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


def test_accept_requires_auth(consent_db):
    app.dependency_overrides.pop(get_current_user, None)

    response = client.post(
        "/api/v1/consent/accept",
        json={"consent_type": "recording", "version": CURRENT_CONSENT_TERMS_VERSION},
    )

    assert response.status_code == 401


def test_status_requires_auth(consent_db):
    app.dependency_overrides.pop(get_current_user, None)

    response = client.get("/api/v1/consent/status", params={"consent_type": "recording"})

    assert response.status_code == 401


def test_status_returns_false_when_no_rows(consent_db):
    response = client.get("/api/v1/consent/status", params={"consent_type": "recording"})

    assert response.status_code == 200
    assert response.json() == {
        "accepted": False,
        "accepted_at": None,
        "consent_type": "recording",
        "version": CURRENT_CONSENT_TERMS_VERSION,
    }


def test_accept_inserts_append_only_row(consent_db):
    response = client.post(
        "/api/v1/consent/accept",
        json={"consent_type": "recording", "version": CURRENT_CONSENT_TERMS_VERSION},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["consent_type"] == "recording"
    assert body["version"] == CURRENT_CONSENT_TERMS_VERSION
    assert body["accepted_at"]
    assert consent_db.committed is True
    assert len(consent_db.rows) == 1
    row = consent_db.rows[0]
    assert row.user_id == USER_ID
    assert row.tenant_id == TENANT_ID
    assert row.consent_type == ConsentType.recording.value
    assert not hasattr(row, "ip_address")


def test_accept_twice_creates_two_rows(consent_db):
    first = client.post(
        "/api/v1/consent/accept",
        json={"consent_type": "walkthrough", "version": CURRENT_CONSENT_TERMS_VERSION},
    )
    second = client.post(
        "/api/v1/consent/accept",
        json={"consent_type": "walkthrough", "version": CURRENT_CONSENT_TERMS_VERSION},
    )

    assert first.status_code == 201
    assert second.status_code == 201
    assert len(consent_db.rows) == 2


def test_recording_and_walkthrough_are_independent(consent_db):
    accept = client.post(
        "/api/v1/consent/accept",
        json={"consent_type": "recording", "version": CURRENT_CONSENT_TERMS_VERSION},
    )
    assert accept.status_code == 201

    recording_status = client.get(
        "/api/v1/consent/status",
        params={"consent_type": "recording"},
    )
    walkthrough_status = client.get(
        "/api/v1/consent/status",
        params={"consent_type": "walkthrough"},
    )

    assert recording_status.status_code == 200
    assert recording_status.json()["accepted"] is True
    assert recording_status.json()["accepted_at"] is not None

    assert walkthrough_status.status_code == 200
    assert walkthrough_status.json() == {
        "accepted": False,
        "accepted_at": None,
        "consent_type": "walkthrough",
        "version": CURRENT_CONSENT_TERMS_VERSION,
    }


def test_status_ignores_stale_terms_version(consent_db):
    consent_db.rows.append(
        ConsentAcceptance(
            id=uuid4(),
            user_id=USER_ID,
            tenant_id=TENANT_ID,
            consent_type=ConsentType.recording.value,
            version="2025-01-01",
            accepted_at=datetime.now(UTC),
        )
    )

    response = client.get("/api/v1/consent/status", params={"consent_type": "recording"})

    assert response.status_code == 200
    assert response.json()["accepted"] is False


def test_status_returns_most_recent_current_acceptance(consent_db):
    older = datetime.now(UTC) - timedelta(days=2)
    newer = datetime.now(UTC) - timedelta(hours=1)
    consent_db.rows.extend(
        [
            ConsentAcceptance(
                id=uuid4(),
                user_id=USER_ID,
                tenant_id=TENANT_ID,
                consent_type=ConsentType.walkthrough.value,
                version=CURRENT_CONSENT_TERMS_VERSION,
                accepted_at=older,
            ),
            ConsentAcceptance(
                id=uuid4(),
                user_id=USER_ID,
                tenant_id=TENANT_ID,
                consent_type=ConsentType.walkthrough.value,
                version=CURRENT_CONSENT_TERMS_VERSION,
                accepted_at=newer,
            ),
        ]
    )

    response = client.get("/api/v1/consent/status", params={"consent_type": "walkthrough"})

    assert response.status_code == 200
    body = response.json()
    assert body["accepted"] is True
    assert body["accepted_at"] == newer.isoformat().replace("+00:00", "Z")


def test_accept_rejects_unknown_consent_type(consent_db):
    response = client.post(
        "/api/v1/consent/accept",
        json={"consent_type": "analytics", "version": CURRENT_CONSENT_TERMS_VERSION},
    )

    assert response.status_code == 422


def test_status_rejects_missing_consent_type(consent_db):
    response = client.get("/api/v1/consent/status")

    assert response.status_code == 422
