from datetime import UTC, datetime
from decimal import Decimal
from types import SimpleNamespace
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

import app.main as main_module
import app.sop_service as sop_service
from app.auth.deps import get_current_user
from app.database import get_db
from app.llm_provider import LlmProviderResult
from app.main import app
from app.models import UserRole
from app.sop_schema import SopPayload, SopStep
from app.storage import get_storage

client = TestClient(app)

DEFAULT_TENANT_ID = UUID("22222222-2222-2222-2222-222222222222")
OTHER_TENANT_ID = UUID("33333333-3333-3333-3333-333333333333")


def _make_user(role: UserRole = UserRole.employee, tenant_id: UUID = DEFAULT_TENANT_ID):
    return SimpleNamespace(
        id=UUID("11111111-1111-1111-1111-111111111111"),
        email="employee@example.com",
        role=role.value,
        tenant_id=tenant_id,
    )


class TestProvider:
    name = "openai"
    model = "gpt-4o"

    def generate_sop(self, session_payload: dict) -> LlmProviderResult:
        return LlmProviderResult(
            sop=SopPayload(
                title=f"OpenAI Draft: {session_payload['workflow_name']}",
                summary="Fake provider response for tests.",
                steps=[
                    SopStep(
                        order=1,
                        title="Interpret workflow events",
                        instruction="Use the ordered event log to infer workflow intent.",
                        source_event_ids=[
                            str(event["id"]) for event in session_payload.get("events", [])
                        ],
                    )
                ],
            ),
            prompt_tokens=10,
            completion_tokens=20,
            cost_usd=Decimal("0.001"),
        )


class FakeDb:
    def __init__(self):
        self.added = []
        self.flushed = False
        self.committed = False
        self.rolled_back = False

    def add(self, item):
        self.added.append(item)

    def flush(self):
        self.flushed = True

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True

    def refresh(self, obj):
        pass


class FailingDb(FakeDb):
    def flush(self):
        raise RuntimeError("database write failed")


def override_get_db():
    db = FakeDb()
    app.state.fake_db = db
    yield db


app.dependency_overrides[get_db] = override_get_db


@pytest.fixture(autouse=True)
def authenticate_requests():
    app.dependency_overrides[get_current_user] = lambda: _make_user()
    yield
    app.dependency_overrides.pop(get_current_user, None)


@pytest.fixture(autouse=True)
def default_tenant_id(monkeypatch):
    monkeypatch.setenv("DEFAULT_TENANT_ID", str(DEFAULT_TENANT_ID))


def valid_session_payload() -> dict:
    return {
        "client_session_id": "11111111-1111-1111-1111-111111111111",
        "workflow_name": "Login flow",
        "started_at": "2026-06-16T12:30:00Z",
        "stopped_at": "2026-06-16T12:31:00Z",
        "events": [
            {
                "type": "navigation",
                "url": "https://example.com/login",
                "timestamp_ms": 1781613000000,
            }
        ],
    }


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_create_session_rejects_malformed_payload():
    response = client.post("/api/v1/sessions", json={"workflow_name": ""})

    assert response.status_code == 422


def test_create_session_accepts_minimal_payload():
    response = client.post("/api/v1/sessions", json=valid_session_payload())

    assert response.status_code == 201
    body = response.json()
    assert body["session_id"]
    assert body["job_id"]
    assert app.state.fake_db.committed is True
    assert app.state.fake_db.rolled_back is False


def test_create_session_rejects_unknown_event_type():
    payload = valid_session_payload()
    payload["events"][0]["type"] = "drag"

    response = client.post("/api/v1/sessions", json=payload)

    assert response.status_code == 422


def test_create_session_rejects_non_positive_timestamp():
    payload = valid_session_payload()
    payload["events"][0]["timestamp_ms"] = 0

    response = client.post("/api/v1/sessions", json=payload)

    assert response.status_code == 422


def test_create_session_rejects_empty_workflow_name():
    payload = valid_session_payload()
    payload["workflow_name"] = ""

    response = client.post("/api/v1/sessions", json=payload)

    assert response.status_code == 422


def test_create_session_rolls_back_when_ingestion_fails():
    def override_failing_db():
        db = FailingDb()
        app.state.fake_db = db
        yield db

    app.dependency_overrides[get_db] = override_failing_db

    try:
        with pytest.raises(RuntimeError, match="database write failed"):
            client.post("/api/v1/sessions", json=valid_session_payload())

        assert app.state.fake_db.committed is False
        assert app.state.fake_db.rolled_back is True
    finally:
        app.dependency_overrides[get_db] = override_get_db


def test_create_session_accepts_screenshot_payload():
    payload = valid_session_payload()
    screenshot_id = "33333333-3333-3333-3333-333333333333"
    payload["screenshots"] = [
        {
            "id": screenshot_id,
            "data_base64": "ZmFrZS1wbmctYnl0ZXM=",
            "content_type": "image/png",
            "width": 1280,
            "height": 720,
        }
    ]
    payload["events"][0]["screenshot_id"] = screenshot_id

    response = client.post("/api/v1/sessions", json=payload)

    assert response.status_code == 201
    assert len(app.state.fake_storage.uploads) == 1
    assert len(app.state.fake_db.added) >= 3


def test_create_session_rejects_invalid_screenshot_base64():
    payload = valid_session_payload()
    payload["screenshots"] = [
        {
            "id": "33333333-3333-3333-3333-333333333333",
            "data_base64": "not valid base64",
            "content_type": "image/png",
        }
    ]

    response = client.post("/api/v1/sessions", json=payload)

    assert response.status_code == 422


class FakeStorage:
    def __init__(self):
        self.uploads = []

    def put_object(self, key: str, body: bytes, content_type: str) -> None:
        self.uploads.append(
            {
                "key": key,
                "body": body,
                "content_type": content_type,
            }
        )

    def generate_signed_url(self, key: str, expires: int = 60 * 60 * 24):
        return f"https://signed.example/{key}"


def override_get_storage():
    storage = FakeStorage()
    app.state.fake_storage = storage
    return storage


@pytest.fixture(autouse=True)
def fake_storage(monkeypatch):
    app.dependency_overrides[get_storage] = override_get_storage
    monkeypatch.setattr(
        sop_service,
        "get_storage",
        override_get_storage,
    )
    yield
    app.dependency_overrides.pop(get_storage, None)


class FakeDbWithSession(FakeDb):
    def __init__(
        self,
        session=None,
        existing_sop=None,
        job=None,
        events=None,
        screenshot=None,
        sops=None,
    ):
        super().__init__()

        self.session = session
        self.existing_sop = existing_sop
        self.job = job

        self.events = events or []
        self.screenshot = screenshot
        self.sops = sops or []
        self._tenant_id_filter = None

        self.current_model = None

    def query(self, model):
        self.current_model = model
        self._tenant_id_filter = None
        return self

    def filter(self, *args):
        for criterion in args:
            left = getattr(criterion, "left", None)
            right = getattr(criterion, "right", None)
            if left is not None and getattr(left, "key", None) == "tenant_id":
                self._tenant_id_filter = getattr(right, "value", right)
        return self

    def order_by(self, *args):
        return self

    def first(self):
        if self.current_model == main_module.models.Session:
            if self.session is None:
                return None
            if (
                self._tenant_id_filter is not None
                and getattr(self.session, "tenant_id", self._tenant_id_filter)
                != self._tenant_id_filter
            ):
                return None
            return self.session

        if self.current_model == main_module.models.Sop:
            if self.existing_sop is None:
                return None
            if (
                self._tenant_id_filter is not None
                and getattr(self.existing_sop, "tenant_id", self._tenant_id_filter)
                != self._tenant_id_filter
            ):
                return None
            return self.existing_sop

        if self.current_model == main_module.models.CodificationJob:
            return self.job

        if self.current_model == main_module.models.Screenshot:
            return self.screenshot

        return None

    def all(self):
        if self.current_model == main_module.models.Event:
            return self.events

        if self.current_model == main_module.models.Sop:
            return self.sops

        return []


class FakeDbWithSessionStatus(FakeDb):
    def __init__(self, session, job=None, sop=None):
        super().__init__()
        self.results = [session, job, sop]

    def query(self, model):
        return self

    def filter(self, *args):
        return self

    def order_by(self, *args):
        return self

    def first(self):
        return self.results.pop(0)


def test_get_session_status_returns_completed_sop_id():
    from types import SimpleNamespace

    session_id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    sop_id = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    fake_session = SimpleNamespace(id=session_id, workflow_name="Login Flow")
    fake_job = SimpleNamespace(status="completed")
    fake_sop = SimpleNamespace(id=sop_id)
    db = FakeDbWithSessionStatus(session=fake_session, job=fake_job, sop=fake_sop)

    app.dependency_overrides[get_db] = lambda: db

    try:
        response = client.get(f"/api/v1/sessions/{session_id}")

        assert response.status_code == 200
        assert response.json() == {
            "session_id": session_id,
            "workflow_name": "Login Flow",
            "job_status": "completed",
            "sop_id": sop_id,
        }
    finally:
        app.dependency_overrides[get_db] = override_get_db


def test_get_session_status_returns_failed_with_null_sop_id():
    from types import SimpleNamespace

    session_id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    fake_session = SimpleNamespace(id=session_id, workflow_name="Login Flow")
    fake_job = SimpleNamespace(status="failed")
    db = FakeDbWithSessionStatus(session=fake_session, job=fake_job, sop=None)

    app.dependency_overrides[get_db] = lambda: db

    try:
        response = client.get(f"/api/v1/sessions/{session_id}")

        assert response.status_code == 200
        assert response.json() == {
            "session_id": session_id,
            "workflow_name": "Login Flow",
            "job_status": "failed",
            "sop_id": None,
        }
    finally:
        app.dependency_overrides[get_db] = override_get_db


def test_generate_sop_returns_201(monkeypatch):
    from types import SimpleNamespace

    fake_job = SimpleNamespace(status="pending")
    fake_session = SimpleNamespace(
        id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        workflow_name="Login Flow",
        events=[
            SimpleNamespace(
                id=1,
                seq=0,
                type="navigation",
                url="https://example.com/login",
                target_label=None,
                target_selector=None,
            ),
        ],
    )

    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setattr(
        "app.llm_sop_generator.get_llm_provider",
        lambda: TestProvider(),
    )

    db = FakeDbWithSession(
        session=fake_session,
        job=fake_job,
    )

    app.dependency_overrides[get_db] = lambda: db
    try:
        response = client.post(f"/api/v1/sessions/{fake_session.id}/generate-sop")

        assert response.status_code == 201
        body = response.json()
        assert "steps" in body
        assert "warnings" in body
        assert db.committed is True
        assert fake_job.status == "completed"
        assert body["title"] == "OpenAI Draft: Login Flow"

    finally:
        app.dependency_overrides[get_db] = override_get_db


def test_generate_sop_returns_404_when_session_missing():
    db = FakeDbWithSession(session=None)

    app.dependency_overrides[get_db] = lambda: db

    try:
        response = client.post("/api/v1/sessions/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/generate-sop")

        assert response.status_code == 404
    finally:
        app.dependency_overrides[get_db] = override_get_db


def test_generate_sop_returns_409_when_sop_exists():
    from types import SimpleNamespace

    fake_session = SimpleNamespace(
        id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        workflow_name="Login Flow",
        events=[],
    )

    db = FakeDbWithSession(
        session=fake_session,
        existing_sop=object(),
    )

    app.dependency_overrides[get_db] = lambda: db

    try:
        response = client.post(f"/api/v1/sessions/{fake_session.id}/generate-sop")

        assert response.status_code == 409

    finally:
        app.dependency_overrides[get_db] = override_get_db


# Tests for retrieving SOP details via the GET /api/v1/sops/{id} endpoint
def test_get_sop_returns_404():
    db = FakeDbWithSession(
        existing_sop=None,
    )

    app.dependency_overrides[get_db] = lambda: db

    try:
        response = client.get("/api/v1/sops/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")

        assert response.status_code == 404

    finally:
        app.dependency_overrides[get_db] = override_get_db


def test_get_sop_returns_200():
    from datetime import UTC, datetime
    from types import SimpleNamespace

    fake_sop = SimpleNamespace(
        id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        title="Login Flow",
        version=1,
        generated_at=datetime.now(UTC),
        steps=[
            {
                "order": 1,
                "title": "Login",
                "instruction": "Click Login",
                "source_event_ids": [],
            }
        ],
        warnings=[],
    )

    db = FakeDbWithSession(
        existing_sop=fake_sop,
    )

    app.dependency_overrides[get_db] = lambda: db

    try:
        response = client.get("/api/v1/sops/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")

        assert response.status_code == 200

        body = response.json()

        assert body["title"] == "Login Flow"
        assert body["version"] == 1
        assert len(body["steps"]) == 1
        assert body["steps"][0]["title"] == "Login"
        assert body["steps"][0]["screenshot_url"] is None
        assert body["id"] == "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        assert body["generated_at"] is not None
        assert body["warnings"] == []

    finally:
        app.dependency_overrides[get_db] = override_get_db


def test_get_sop_returns_signed_screenshot_url():
    from datetime import UTC, datetime
    from types import SimpleNamespace
    from uuid import UUID

    fake_event = SimpleNamespace(
        id=1,
        seq=1,
        screenshot_id=UUID("22222222-2222-2222-2222-222222222222"),
    )

    fake_screenshot = SimpleNamespace(
        id=UUID("22222222-2222-2222-2222-222222222222"),
        object_key="screenshots/login.png",
    )

    fake_sop = SimpleNamespace(
        id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        title="Login Flow",
        version=1,
        generated_at=datetime.now(UTC),
        steps=[
            {
                "order": 1,
                "title": "Login",
                "instruction": "Click Login",
                "source_event_ids": ["1"],
            }
        ],
        warnings=[],
    )

    db = FakeDbWithSession(
        existing_sop=fake_sop,
        events=[fake_event],
        screenshot=fake_screenshot,
    )

    app.dependency_overrides[get_db] = lambda: db

    try:
        response = client.get("/api/v1/sops/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")

        assert response.status_code == 200

        body = response.json()

        assert body["steps"][0]["screenshot_url"] == "https://signed.example/screenshots/login.png"

    finally:
        app.dependency_overrides[get_db] = override_get_db


def test_generate_sop_can_use_llm_generator(monkeypatch):
    from types import SimpleNamespace

    from app.sop_schema import SopPayload, SopStep

    class TestProvider:
        name = "openai"
        model = "gpt-4o"

        def generate_sop(self, session_payload: dict) -> SopPayload:
            return LlmProviderResult(
                sop=SopPayload(
                    title=f"LLM Draft: {session_payload['workflow_name']}",
                    summary="Generated by endpoint test provider.",
                    steps=[
                        SopStep(
                            order=1,
                            title="Use workflow events",
                            instruction="Generate SOP from the ordered event log.",
                            branch="main",
                            source_event_ids=[
                                event["id"] for event in session_payload.get("events", [])
                            ],
                        )
                    ],
                ),
                prompt_tokens=10,
                completion_tokens=20,
                cost_usd=Decimal("0.001"),
            )

    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setattr(
        "app.llm_sop_generator.get_llm_provider",
        lambda: TestProvider(),
    )

    fake_job = SimpleNamespace(status="pending")
    fake_session = SimpleNamespace(
        id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        workflow_name="Login Flow",
        events=[
            SimpleNamespace(
                id=1,
                seq=0,
                type="navigation",
                url="https://example.com/login",
                target_label=None,
                target_selector=None,
            ),
        ],
    )

    db = FakeDbWithSession(
        session=fake_session,
        job=fake_job,
    )

    app.dependency_overrides[get_db] = lambda: db
    try:
        response = client.post(f"/api/v1/sessions/{fake_session.id}/generate-sop")

        assert response.status_code == 201
        body = response.json()
        assert body["generation_mode"] == "llm"
        assert body["title"] == "LLM Draft: Login Flow"
        assert body["steps"][0]["branch"] == "main"
        assert body["steps"][0]["source_event_ids"] == ["1"]
        assert db.committed is True
        sop = db.added[-1]
        assert sop.generation_mode == "llm"
        assert sop.gen_duration_ms >= 0
        assert fake_job.status == "completed"
        audit_logs = [item for item in db.added if item.__class__.__name__ == "LlmAuditLog"]
        assert len(audit_logs) == 1
        assert audit_logs[0].status == "success"

    finally:
        app.dependency_overrides[get_db] = override_get_db


def test_create_session_requires_authentication():
    app.dependency_overrides.pop(get_current_user, None)

    response = client.post("/api/v1/sessions", json=valid_session_payload())

    assert response.status_code == 401


def test_get_session_cross_tenant_returns_404():
    session_id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    fake_session = SimpleNamespace(
        id=session_id,
        workflow_name="Login Flow",
        tenant_id=OTHER_TENANT_ID,
    )
    db = FakeDbWithSession(session=fake_session)
    app.dependency_overrides[get_db] = lambda: db

    try:
        response = client.get(f"/api/v1/sessions/{session_id}")
        assert response.status_code == 404
    finally:
        app.dependency_overrides[get_db] = override_get_db


def test_publish_sop_success():
    fake_sop = SimpleNamespace(
        id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        status=main_module.models.SopStatus.approved.value,
        published_at=None,
        tenant_id=DEFAULT_TENANT_ID,
    )
    db = FakeDbWithSession(existing_sop=fake_sop)
    db.refresh = lambda obj: None
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: _make_user(role=UserRole.reviewer)

    try:
        response = client.post("/api/v1/sops/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/publish")

        assert response.status_code == 200
        body = response.json()
        assert body["id"] == "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        assert body["status"] == "published"
        assert body["published_at"] is not None
        assert body["library_url"] == "/library/sops/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        assert db.committed is True
        assert fake_sop.status == main_module.models.SopStatus.published.value
        assert fake_sop.published_at is not None
    finally:
        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides.pop(get_current_user, None)


def test_employee_publish_sop_returns_403():
    fake_sop = SimpleNamespace(
        id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        status=main_module.models.SopStatus.approved.value,
        published_at=None,
        tenant_id=DEFAULT_TENANT_ID,
    )
    db = FakeDbWithSession(existing_sop=fake_sop)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: _make_user(role=UserRole.employee)

    try:
        response = client.post("/api/v1/sops/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/publish")
        assert response.status_code == 403
        assert response.json()["detail"] == "Reviewer role required"
        assert db.committed is False
    finally:
        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides.pop(get_current_user, None)


@pytest.mark.parametrize(
    "existing_sop, expected_status, expected_detail",
    [
        (None, 404, "SOP not found"),
        (
            SimpleNamespace(
                id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                status=main_module.models.SopStatus.draft.value,
                published_at=None,
                tenant_id=DEFAULT_TENANT_ID,
            ),
            422,
            "SOP must be approved before publishing",
        ),
    ],
)
def test_publish_sop_errors(existing_sop, expected_status, expected_detail):
    db = FakeDbWithSession(existing_sop=existing_sop)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: _make_user(role=UserRole.reviewer)

    try:
        response = client.post("/api/v1/sops/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/publish")
        assert response.status_code == expected_status
        assert response.json()["detail"] == expected_detail
        assert db.committed is False
    finally:
        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides.pop(get_current_user, None)


def test_list_published_sops():
    fake_sop = SimpleNamespace(
        id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        title="Login Flow",
        status=main_module.models.SopStatus.published.value,
        published_at=datetime.now(UTC),
        tenant_id=DEFAULT_TENANT_ID,
        steps=[{}, {}],
    )
    db = FakeDbWithSession(sops=[fake_sop])
    app.dependency_overrides[get_db] = lambda: db

    try:
        response = client.get("/api/v1/sops?status=published")
        assert response.status_code == 200
        body = response.json()
        assert len(body["sops"]) == 1
        assert body["sops"][0]["id"] == fake_sop.id
        assert body["sops"][0]["title"] == "Login Flow"
        assert body["sops"][0]["step_count"] == 2
    finally:
        app.dependency_overrides[get_db] = override_get_db


def test_list_sops_requires_authentication():
    db = FakeDbWithSession()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides.pop(get_current_user, None)

    try:
        response = client.get("/api/v1/sops")
        assert response.status_code == 401
    finally:
        app.dependency_overrides[get_db] = override_get_db
