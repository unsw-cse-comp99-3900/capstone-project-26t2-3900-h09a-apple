from types import SimpleNamespace

from fastapi.testclient import TestClient

import app.feedback_routes as feedback_routes
from app.auth.deps import get_current_user
from app.main import app
from app.models import UserRole

client = TestClient(app)


def test_transcribe_feedback_requires_auth():
    app.dependency_overrides.pop(get_current_user, None)

    response = client.post(
        "/api/v1/feedback/transcribe",
        files={"audio": ("feedback.webm", b"fake-audio", "audio/webm")},
    )

    assert response.status_code == 401


def test_transcribe_feedback_rejects_invalid_role():
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(role="INVALID_ROLE")

    try:
        response = client.post(
            "/api/v1/feedback/transcribe",
            files={"audio": ("feedback.webm", b"fake-audio", "audio/webm")},
        )

        assert response.status_code == 403
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_transcribe_feedback_returns_transcript(monkeypatch):
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(
        role=UserRole.employee.value
    )

    async def fake_transcribe_upload(audio):
        assert audio.filename == "feedback.webm"
        return {
            "transcript": "This is clear feedback.",
            "duration_seconds": 3.2,
            "language": "en",
        }

    monkeypatch.setattr(feedback_routes, "transcribe_upload", fake_transcribe_upload)

    try:
        response = client.post(
            "/api/v1/feedback/transcribe",
            files={"audio": ("feedback.webm", b"fake-audio", "audio/webm")},
        )

        assert response.status_code == 200
        assert response.json() == {
            "transcript": "This is clear feedback.",
            "duration_seconds": 3.2,
            "language": "en",
        }
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_transcribe_feedback_returns_413_for_long_audio(monkeypatch):
    from fastapi import HTTPException, status

    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(
        role=UserRole.employee.value
    )

    async def fake_transcribe_upload(audio):
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Audio must be 60 seconds or shorter",
        )

    monkeypatch.setattr(feedback_routes, "transcribe_upload", fake_transcribe_upload)

    try:
        response = client.post(
            "/api/v1/feedback/transcribe",
            files={"audio": ("feedback.webm", b"fake-audio", "audio/webm")},
        )

        assert response.status_code == 413
        assert response.json()["detail"] == "Audio must be 60 seconds or shorter"
    finally:
        app.dependency_overrides.pop(get_current_user, None)
