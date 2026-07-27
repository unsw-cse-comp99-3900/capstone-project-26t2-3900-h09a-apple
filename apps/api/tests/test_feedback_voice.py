from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

from fastapi.testclient import TestClient

import app.feedback_routes as feedback_routes
from app.auth.deps import get_current_user
from app.email.sender import clear_mock_email_outbox, get_mock_email_outbox
from app.main import app
from app.models import (
    FeedbackClassification,
    FeedbackPolarity,
    FeedbackSeverity,
    UserRole,
)
from app.storage import get_storage

client = TestClient(app)

TENANT = uuid4()
EMPLOYEE_ID = uuid4()
REVIEWER_ID = uuid4()
MANAGER_ID = uuid4()
SOP_ID = uuid4()


def _restore_override(dependency, previous):
    if previous is None:
        app.dependency_overrides.pop(dependency, None)
    else:
        app.dependency_overrides[dependency] = previous


class FakeStorage:
    def __init__(self):
        self.uploads = []

    def put_object(self, key: str, body: bytes, content_type: str) -> None:
        self.uploads.append({"key": key, "body": body, "content_type": content_type})

    def generate_signed_url(self, key: str, expires: int = 60 * 60 * 24):
        return f"https://signed.example/{key}?e={expires}"


class FakeQuery:
    def __init__(self, rows):
        self.rows = list(rows)
        self._filters = []

    def join(self, *args, **kwargs):
        return self

    def filter(self, *args, **kwargs):
        self._filters.extend(args)
        return self

    def group_by(self, *args, **kwargs):
        return self

    def order_by(self, *args, **kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def count(self):
        return len(self.rows)

    def first(self):
        return self.rows[0] if self.rows else None

    def all(self):
        return list(self.rows)


class FakeDB:
    def __init__(self):
        self.added = []
        self.committed = False

    def query(self, *entities):
        if entities and getattr(entities[0], "__name__", None) == "Sop":
            return FakeQuery(
                [SimpleNamespace(id=SOP_ID, title="Refund workflow", tenant_id=TENANT)]
            )
        if entities and getattr(entities[0], "__name__", None) == "User":
            return FakeQuery(
                [
                    SimpleNamespace(
                        id=REVIEWER_ID,
                        email="reviewer@example.com",
                        role=UserRole.reviewer.value,
                        tenant_id=TENANT,
                    ),
                    SimpleNamespace(
                        id=MANAGER_ID,
                        email="manager@example.com",
                        role=UserRole.manager.value,
                        tenant_id=TENANT,
                    ),
                ]
            )
        return FakeQuery([])

    def add(self, obj):
        if getattr(obj, "id", None) is None:
            obj.id = uuid4()
        self.added.append(obj)

    def flush(self):
        for obj in self.added:
            if getattr(obj, "id", None) is None:
                obj.id = uuid4()

    def commit(self):
        self.committed = True

    def refresh(self, obj):
        return obj


def _employee():
    return SimpleNamespace(
        id=EMPLOYEE_ID,
        email="employee@example.com",
        role=UserRole.employee.value,
        tenant_id=TENANT,
    )


def test_upload_voice_feedback_persists_classifies_and_emails(monkeypatch):
    clear_mock_email_outbox()
    monkeypatch.setenv("WEB_BASE_URL", "http://localhost:3000")
    storage = FakeStorage()
    db = FakeDB()

    async def fake_transcribe(audio_bytes, *, suffix=".webm"):
        assert audio_bytes == b"fake-audio"
        assert suffix == ".webm"
        return {
            "transcript": "The save button is broken and I am stuck.",
            "duration_seconds": 4.5,
            "language": "en",
        }

    monkeypatch.setattr(feedback_routes, "transcribe_audio_bytes", fake_transcribe)
    monkeypatch.setattr(
        feedback_routes,
        "classify_feedback_transcript",
        lambda _text: SimpleNamespace(
            classification=FeedbackClassification.friction,
            polarity=FeedbackPolarity.issue,
            severity=FeedbackSeverity.high,
        ),
    )

    from app.database import get_db

    previous_user = app.dependency_overrides.get(get_current_user)
    previous_storage = app.dependency_overrides.get(get_storage)
    previous_db = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_current_user] = _employee
    app.dependency_overrides[get_storage] = lambda: storage
    app.dependency_overrides[get_db] = lambda: db

    try:
        response = client.post(
            "/api/v1/feedback/voice",
            data={"sop_id": str(SOP_ID)},
            files={"audio": ("feedback.webm", b"fake-audio", "audio/webm")},
        )
    finally:
        _restore_override(get_current_user, previous_user)
        _restore_override(get_storage, previous_storage)
        _restore_override(get_db, previous_db)

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["classification"] == "friction"
    assert body["severity"] == "high"
    assert body["transcript"].startswith("The save button")
    assert storage.uploads
    assert db.committed
    assert len(get_mock_email_outbox()) >= 1
    assert "uploaded feedback on Refund workflow" in get_mock_email_outbox()[0].text_body


def test_upload_voice_feedback_requires_sop_id(monkeypatch):
    from app.database import get_db

    previous_user = app.dependency_overrides.get(get_current_user)
    previous_storage = app.dependency_overrides.get(get_storage)
    previous_db = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_current_user] = _employee
    app.dependency_overrides[get_storage] = lambda: FakeStorage()
    app.dependency_overrides[get_db] = lambda: FakeDB()

    async def fake_transcribe(audio_bytes, *, suffix=".webm"):
        return {"transcript": "x", "duration_seconds": 1.0, "language": "en"}

    monkeypatch.setattr(feedback_routes, "transcribe_audio_bytes", fake_transcribe)

    try:
        response = client.post(
            "/api/v1/feedback/voice",
            files={"audio": ("feedback.webm", b"fake-audio", "audio/webm")},
        )
    finally:
        _restore_override(get_current_user, previous_user)
        _restore_override(get_storage, previous_storage)
        _restore_override(get_db, previous_db)

    assert response.status_code == 422


def test_classify_feedback_heuristic_detects_friction():
    from app.feedback_storage import classify_feedback_heuristic

    result = classify_feedback_heuristic("I cannot continue, the form is broken")
    assert result.classification.value == "friction"
    assert result.severity.value == "high"
    assert result.polarity.value == "issue"


def test_review_voice_feedback_marks_reviewed(monkeypatch):
    from app.database import get_db

    now = datetime.now(UTC)
    feedback = SimpleNamespace(
        id=uuid4(),
        sop_id=SOP_ID,
        employee_id=EMPLOYEE_ID,
        transcript="hello",
        classification="question",
        polarity="issue",
        severity="medium",
        status="pending",
        duration_seconds=2.0,
        language="en",
        reviewer_comment=None,
        reviewer_tags=[],
        reviewed_by=None,
        reviewed_at=None,
        recorded_at=now,
        created_at=now,
        updated_at=now,
        tenant_id=TENANT,
    )
    employee = SimpleNamespace(id=EMPLOYEE_ID, email="employee@example.com")
    sop = SimpleNamespace(id=SOP_ID, title="Refund workflow")

    class ReviewDB(FakeDB):
        def query(self, *entities):
            return FakeQuery([(feedback, employee, sop)])

    def reviewer():
        return SimpleNamespace(
            id=REVIEWER_ID,
            email="reviewer@example.com",
            role=UserRole.reviewer.value,
            tenant_id=TENANT,
        )

    previous_user = app.dependency_overrides.get(get_current_user)
    previous_db = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_current_user] = reviewer
    app.dependency_overrides[get_db] = lambda: ReviewDB()

    try:
        response = client.patch(
            f"/api/v1/feedback/{feedback.id}/review",
            json={"comment": "Looks valid", "tags": ["ux"], "mark_reviewed": True},
        )
    finally:
        _restore_override(get_current_user, previous_user)
        _restore_override(get_db, previous_db)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "reviewed"
    assert body["reviewer_comment"] == "Looks valid"
    assert body["reviewer_tags"] == ["ux"]
