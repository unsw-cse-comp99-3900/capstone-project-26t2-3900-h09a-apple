import pytest
from fastapi.testclient import TestClient

import app.main as main_module
from app.database import get_db
from app.main import app

client = TestClient(app)


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


class FailingDb(FakeDb):
    def flush(self):
        raise RuntimeError("database write failed")


def override_get_db():
    db = FakeDb()
    app.state.fake_db = db
    yield db


app.dependency_overrides[get_db] = override_get_db


@pytest.fixture(autouse=True)
def default_tenant_id(monkeypatch):
    monkeypatch.setenv("DEFAULT_TENANT_ID", "22222222-2222-2222-2222-222222222222")


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


def override_get_storage():
    storage = FakeStorage()
    app.state.fake_storage = storage
    return storage

@pytest.fixture(autouse=True)
def fake_storage(monkeypatch):
    monkeypatch.setattr(main_module, "get_storage", override_get_storage)
