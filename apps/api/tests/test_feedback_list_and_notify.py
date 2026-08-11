from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import app.feedback_routes as feedback_routes
from app.auth.deps import get_current_user
from app.auth.jwt import verify_access_or_ws_token
from app.database import get_db
from app.feedback_notify import NotificationHub, NotificationPushPayload
from app.main import app
from app.models import UserRole
from app.storage import get_storage

client = TestClient(app)

TENANT = uuid4()
REVIEWER_ID = uuid4()
EMPLOYEE_ID = uuid4()
SOP_ID = uuid4()
FEEDBACK_ID = uuid4()
NOTIF_ID = uuid4()


def _restore(dependency, previous):
    if previous is None:
        app.dependency_overrides.pop(dependency, None)
    else:
        app.dependency_overrides[dependency] = previous


def _reviewer():
    return SimpleNamespace(
        id=REVIEWER_ID,
        email="reviewer@example.com",
        role=UserRole.reviewer.value,
        tenant_id=TENANT,
    )


def _manager():
    return SimpleNamespace(
        id=uuid4(),
        email="manager@example.com",
        role=UserRole.manager.value,
        tenant_id=TENANT,
    )


class FakeStorage:
    def generate_signed_url(self, key: str, expires: int = 3600):
        return f"https://signed.example/{key}?e={expires}"


class FakeQuery:
    def __init__(self, rows):
        self.rows = list(rows)

    def join(self, *a, **k):
        return self

    def filter(self, *a, **k):
        return self

    def group_by(self, *a, **k):
        return self

    def order_by(self, *a, **k):
        return self

    def limit(self, *_a, **_k):
        return self

    def count(self):
        return len(self.rows)

    def first(self):
        return self.rows[0] if self.rows else None

    def all(self):
        return list(self.rows)


def _feedback_row():
    now = datetime.now(UTC)
    feedback = SimpleNamespace(
        id=FEEDBACK_ID,
        sop_id=SOP_ID,
        employee_id=EMPLOYEE_ID,
        transcript="stuck on save",
        classification="friction",
        polarity="issue",
        severity="high",
        status="pending",
        duration_seconds=3.0,
        language="en",
        reviewer_comment=None,
        reviewer_tags=[],
        reviewed_by=None,
        reviewed_at=None,
        recorded_at=now,
        created_at=now,
        updated_at=now,
        tenant_id=TENANT,
        audio_object_key="tenants/x/feedback/a.webm",
    )
    employee = SimpleNamespace(id=EMPLOYEE_ID, email="employee@example.com")
    sop = SimpleNamespace(id=SOP_ID, title="Refund")
    return feedback, employee, sop


def test_parse_optional_uuid_and_datetime():
    assert feedback_routes._parse_optional_uuid(None) is None
    assert feedback_routes._parse_optional_uuid("  ") is None
    assert feedback_routes._parse_optional_uuid(str(SOP_ID)) == SOP_ID
    with pytest.raises(HTTPException) as exc:
        feedback_routes._parse_optional_uuid("not-uuid")
    assert exc.value.status_code == 422

    assert feedback_routes._parse_optional_datetime(None) is None
    assert feedback_routes._parse_optional_datetime(" ") is None
    dt = feedback_routes._parse_optional_datetime("2024-01-02T03:04:05Z")
    assert dt.year == 2024
    with pytest.raises(HTTPException) as exc2:
        feedback_routes._parse_optional_datetime("bad-date")
    assert exc2.value.status_code == 422


def test_list_voice_feedback_with_filters_and_audio():
    feedback, employee, sop = _feedback_row()

    class ListDB:
        def query(self, *entities):
            return FakeQuery([(feedback, employee, sop)])

    previous_user = app.dependency_overrides.get(get_current_user)
    previous_db = app.dependency_overrides.get(get_db)
    previous_storage = app.dependency_overrides.get(get_storage)
    app.dependency_overrides[get_current_user] = _reviewer
    app.dependency_overrides[get_db] = lambda: ListDB()
    app.dependency_overrides[get_storage] = lambda: FakeStorage()
    try:
        response = client.get(
            "/api/v1/feedback",
            params={
                "severity": "high",
                "classification": "friction",
                "status": "pending",
                "sop_id": str(SOP_ID),
                "include_audio_url": True,
            },
        )
    finally:
        _restore(get_current_user, previous_user)
        _restore(get_db, previous_db)
        _restore(get_storage, previous_storage)

    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body["feedbacks"]) == 1
    assert body["feedbacks"][0]["severity"] == "high"
    assert "signed.example" in body["feedbacks"][0]["audio_url"]


def test_feedback_stats_for_manager():
    feedback, employee, sop = _feedback_row()

    class StatsDB:
        def query(self, *entities):
            # group_by paths return (key, count) tuples
            if len(entities) == 2:
                key = "friction" if "classification" in str(entities[0]) else "high"
                if "status" in str(entities[0]):
                    key = "pending"
                if "severity" in str(entities[0]):
                    key = "high"
                return FakeQuery([(key, 1)])
            if len(entities) == 3 or (
                len(entities) == 1 and getattr(entities[0], "__name__", "") != "VoiceFeedback"
            ):
                return FakeQuery([(feedback, employee, sop)])
            return FakeQuery([feedback])

    previous_user = app.dependency_overrides.get(get_current_user)
    previous_db = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_current_user] = _manager
    app.dependency_overrides[get_db] = lambda: StatsDB()
    try:
        response = client.get("/api/v1/feedback/stats")
    finally:
        _restore(get_current_user, previous_user)
        _restore(get_db, previous_db)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 1
    assert body["high_severity_open"]


def test_get_voice_feedback_and_audio_url_and_404():
    feedback, employee, sop = _feedback_row()

    class GetDB:
        def __init__(self, empty=False):
            self.empty = empty

        def query(self, *entities):
            if self.empty:
                return FakeQuery([])
            # audio-url queries VoiceFeedback alone; detail/review join 3 entities
            if len(entities) == 1:
                return FakeQuery([feedback])
            return FakeQuery([(feedback, employee, sop)])

    previous_user = app.dependency_overrides.get(get_current_user)
    previous_db = app.dependency_overrides.get(get_db)
    previous_storage = app.dependency_overrides.get(get_storage)
    app.dependency_overrides[get_current_user] = _reviewer
    app.dependency_overrides[get_storage] = lambda: FakeStorage()

    app.dependency_overrides[get_db] = lambda: GetDB()
    try:
        got = client.get(f"/api/v1/feedback/{FEEDBACK_ID}")
        audio = client.get(f"/api/v1/feedback/{FEEDBACK_ID}/audio-url")
    finally:
        pass

    assert got.status_code == 200
    assert audio.status_code == 200
    assert "signed.example" in audio.json()["url"]

    app.dependency_overrides[get_db] = lambda: GetDB(empty=True)
    try:
        missing = client.get(f"/api/v1/feedback/{uuid4()}")
        missing_audio = client.get(f"/api/v1/feedback/{uuid4()}/audio-url")
        missing_review = client.patch(
            f"/api/v1/feedback/{uuid4()}/review",
            json={"comment": "x", "tags": [], "mark_reviewed": False},
        )
    finally:
        _restore(get_current_user, previous_user)
        _restore(get_db, previous_db)
        _restore(get_storage, previous_storage)

    assert missing.status_code == 404
    assert missing_audio.status_code == 404
    assert missing_review.status_code == 404


def test_notifications_list_mark_read_and_ws_ticket():
    now = datetime.now(UTC)
    row = SimpleNamespace(
        id=NOTIF_ID,
        feedback_id=FEEDBACK_ID,
        event_type="feedback.uploaded",
        title="t",
        body="b",
        delivered_via="inbox",
        read_at=None,
        created_at=now,
        recipient_id=REVIEWER_ID,
        tenant_id=TENANT,
    )

    class NotifDB:
        def query(self, *entities):
            return FakeQuery([row])

        def commit(self):
            return None

        def refresh(self, obj):
            return obj

    previous_user = app.dependency_overrides.get(get_current_user)
    previous_db = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_current_user] = _reviewer
    app.dependency_overrides[get_db] = lambda: NotifDB()
    try:
        listed = client.get("/api/v1/notifications", params={"unread_only": True})
        marked = client.post(f"/api/v1/notifications/{NOTIF_ID}/read")
        ticket = client.post("/api/v1/notifications/ws-ticket")
        missing = client.post(f"/api/v1/notifications/{uuid4()}/read")
    finally:
        _restore(get_current_user, previous_user)
        _restore(get_db, previous_db)

    # Missing uses empty query - override FakeQuery empty for that call only hard;
    # mark with empty is 404. Re-run missing with empty db:
    assert listed.status_code == 200, listed.text
    assert len(listed.json()["notifications"]) == 1
    assert marked.status_code == 200
    assert marked.json()["read_at"] is not None
    assert ticket.status_code == 200
    assert verify_access_or_ws_token(ticket.json()["ticket"])["role"] == UserRole.reviewer.value

    app.dependency_overrides[get_current_user] = _reviewer
    app.dependency_overrides[get_db] = lambda: type(
        "E",
        (),
        {
            "query": lambda self, *a: FakeQuery([]),
            "commit": lambda self: None,
            "refresh": lambda self, o: o,
        },
    )()
    try:
        missing = client.post(f"/api/v1/notifications/{uuid4()}/read")
    finally:
        _restore(get_current_user, previous_user)
        _restore(get_db, previous_db)
    assert missing.status_code == 404


def test_notification_hub_connect_push_disconnect():
    import asyncio

    hub = NotificationHub()
    user_id = uuid4()

    class _WS:
        def __init__(self):
            self.texts = []

        async def accept(self):
            return None

        async def send_text(self, message):
            self.texts.append(message)

    async def _run():
        ws = _WS()
        await hub.connect(user_id, ws)
        assert hub.has_connection(user_id)
        ok = await hub.push(
            user_id,
            NotificationPushPayload(
                event="feedback.uploaded",
                notification_id=str(uuid4()),
                feedback_id=str(FEEDBACK_ID),
                title="t",
                body="b",
                review_path="/review",
            ),
        )
        assert ok is True
        assert ws.texts
        await hub.disconnect(user_id, ws)
        assert not hub.has_connection(user_id)
        assert (
            await hub.push(
                user_id,
                NotificationPushPayload(
                    event="x",
                    notification_id="1",
                    feedback_id="2",
                    title="t",
                    body="b",
                    review_path="/r",
                ),
            )
            is False
        )

    asyncio.run(_run())


def test_upload_voice_feedback_invalid_uuid_and_missing_sop(monkeypatch):
    previous_user = app.dependency_overrides.get(get_current_user)
    previous_db = app.dependency_overrides.get(get_db)
    previous_storage = app.dependency_overrides.get(get_storage)
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(
        id=EMPLOYEE_ID,
        email="e@example.com",
        role=UserRole.employee.value,
        tenant_id=TENANT,
    )
    app.dependency_overrides[get_storage] = lambda: FakeStorage()

    class EmptySopDB:
        def query(self, *entities):
            return FakeQuery([])

    app.dependency_overrides[get_db] = lambda: EmptySopDB()

    async def fake_transcribe(*a, **k):
        return {"transcript": "x", "duration_seconds": 1.0, "language": "en"}

    monkeypatch.setattr(feedback_routes, "transcribe_audio_bytes", fake_transcribe)

    try:
        bad_uuid = client.post(
            "/api/v1/feedback/voice",
            data={"sop_id": "not-a-uuid"},
            files={"audio": ("f.webm", b"a", "audio/webm")},
        )
        missing_sop = client.post(
            "/api/v1/feedback/voice",
            data={"sop_id": str(uuid4()), "recorded_at": "2024-06-01T12:00:00Z"},
            files={"audio": ("f.webm", b"a", "audio/webm")},
        )
    finally:
        _restore(get_current_user, previous_user)
        _restore(get_db, previous_db)
        _restore(get_storage, previous_storage)

    assert bad_uuid.status_code == 422
    assert missing_sop.status_code == 404
