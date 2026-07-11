import pytest

from app.openai_client import create_openai_compatible_client


def test_create_client_requires_api_key(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    with pytest.raises(RuntimeError, match="OPENAI_API_KEY or OPENROUTER_API_KEY"):
        create_openai_compatible_client()


def test_create_client_uses_openai_key_by_default(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_BASE_URL", raising=False)
    monkeypatch.delenv("OPENROUTER_BASE_URL", raising=False)

    captured: dict[str, object] = {}

    def fake_openai(**kwargs):
        captured.update(kwargs)
        return "client"

    monkeypatch.setattr("app.openai_client.OpenAI", fake_openai)

    client = create_openai_compatible_client()

    assert client == "client"
    assert captured["api_key"] == "sk-test"
    assert "base_url" not in captured


def test_create_client_uses_openrouter_defaults(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test")
    monkeypatch.delenv("OPENAI_BASE_URL", raising=False)
    monkeypatch.delenv("OPENROUTER_BASE_URL", raising=False)

    captured: dict[str, object] = {}

    def fake_openai(**kwargs):
        captured.update(kwargs)
        return "client"

    monkeypatch.setattr("app.openai_client.OpenAI", fake_openai)

    create_openai_compatible_client()

    assert captured["api_key"] == "sk-or-test"
    assert captured["base_url"] == "https://openrouter.ai/api/v1"
    assert captured["default_headers"] == {
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "WorkTrace",
    }


def test_create_client_honors_explicit_base_url(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://openrouter.ai/api/v1/")
    monkeypatch.setenv("OPENROUTER_SITE_URL", "https://worktrace.example")
    monkeypatch.setenv("OPENROUTER_APP_NAME", "WorkTrace Dev")

    captured: dict[str, object] = {}

    def fake_openai(**kwargs):
        captured.update(kwargs)
        return "client"

    monkeypatch.setattr("app.openai_client.OpenAI", fake_openai)

    create_openai_compatible_client()

    assert captured["base_url"] == "https://openrouter.ai/api/v1"
    assert captured["default_headers"] == {
        "HTTP-Referer": "https://worktrace.example",
        "X-Title": "WorkTrace Dev",
    }
