from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

from fastapi.testclient import TestClient

from app.assistant_routes import (
    build_walkthrough_assistant_prompt,
    parse_confidence_footer,
    resolve_assistant_model,
)
from app.assistant_schema import WalkthroughAssistantRequest
from app.auth.deps import get_current_user
from app.main import app
from app.models import UserRole


def _payload(**overrides):
    base = {
        "task": "qa",
        "mode": "overlay",
        "page_url": "https://example.com/form",
        "page_title": "Form",
        "step": {
            "index": 0,
            "total": 3,
            "title": "Open form",
            "instruction": "Click New",
        },
        "question": "Where is the button?",
        "expected_target": "button#new",
        "actual_action": "clicked cancel",
        "steps_summary": "1 Open\n2 Save",
        "screenshot_b64": None,
    }
    base.update(overrides)
    return WalkthroughAssistantRequest.model_validate(base)


def test_parse_confidence_footer_variants():
    assert parse_confidence_footer("")[1] == "low"
    assert parse_confidence_footer("Just an answer")[1] == "medium"
    answer, level, reason = parse_confidence_footer(
        "Do this next.\nCONFIDENCE: high - clear target"
    )
    assert "Do this next" in answer
    assert level == "high"
    assert "clear" in reason

    empty_answer, level2, _ = parse_confidence_footer("CONFIDENCE: low - no context")
    assert "could not generate" in empty_answer
    assert level2 == "low"


def test_build_prompt_includes_role_and_question():
    prompt = build_walkthrough_assistant_prompt(_payload(), role="EMPLOYEE")
    assert "User role: EMPLOYEE" in prompt
    assert "User question:" in prompt
    assert "ask a manager" in prompt

    coach = build_walkthrough_assistant_prompt(
        _payload(task="coach", question="make clearer"), role="REVIEWER"
    )
    assert "Additional user note:" in coach
    assert "ask a manager" not in coach


def test_resolve_assistant_model_prefers_vision(monkeypatch):
    monkeypatch.delenv("WALKTHROUGH_VISION_MODEL", raising=False)
    monkeypatch.delenv("OPENAI_VISION_MODEL", raising=False)
    monkeypatch.setenv("OPENAI_MODEL", "gpt-4o-mini")
    assert resolve_assistant_model(_payload(task="qa")) == "gpt-4o-mini"

    monkeypatch.setenv("WALKTHROUGH_VISION_MODEL", "gpt-4o")
    assert resolve_assistant_model(_payload(task="analyze", screenshot_b64="abc123")) == "gpt-4o"


def test_walkthrough_assistant_endpoint_503_without_key(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    user = SimpleNamespace(
        id=uuid4(),
        email="e@example.com",
        role=UserRole.employee.value,
        tenant_id=uuid4(),
    )
    previous = app.dependency_overrides.get(get_current_user)
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        response = TestClient(app).post(
            "/api/v1/assistant/walkthrough",
            json=_payload().model_dump(),
        )
    finally:
        if previous is None:
            app.dependency_overrides.pop(get_current_user, None)
        else:
            app.dependency_overrides[get_current_user] = previous

    assert response.status_code == 503
    assert "OPENAI_API_KEY" in response.text or "not configured" in response.text


def test_walkthrough_assistant_success_path(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setenv("OPENAI_MODEL", "gpt-4o-mini")

    class _Msg:
        content = "Click Save next.\nCONFIDENCE: medium - visible button"

    class _Choice:
        message = _Msg()

    class _Completion:
        choices = [_Choice()]

    class _Completions:
        async def create(self, **_kwargs):
            return _Completion()

    class _Chat:
        completions = _Completions()

    class _Client:
        def __init__(self, *a, **k):
            self.chat = _Chat()

    monkeypatch.setitem(__import__("sys").modules, "openai", SimpleNamespace(AsyncOpenAI=_Client))

    class _FakeOpenAI:
        def __init__(self, api_key=None):
            self.chat = _Chat()

    monkeypatch.setattr(
        "openai.AsyncOpenAI",
        _FakeOpenAI,
        raising=False,
    )

    # Ensure import inside function gets our fake
    import openai

    monkeypatch.setattr(openai, "AsyncOpenAI", _FakeOpenAI)

    user = SimpleNamespace(
        id=uuid4(),
        email="e@example.com",
        role=UserRole.employee.value,
        tenant_id=uuid4(),
    )
    previous = app.dependency_overrides.get(get_current_user)
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        response = TestClient(app).post(
            "/api/v1/assistant/walkthrough",
            json=_payload(task="analyze", screenshot_b64="data:image/jpeg;base64,xxx").model_dump(),
        )
    finally:
        if previous is None:
            app.dependency_overrides.pop(get_current_user, None)
        else:
            app.dependency_overrides[get_current_user] = previous

    assert response.status_code == 200, response.text
    body = response.json()
    assert "Click Save" in body["answer"]
    assert body["confidence"] == "medium"
