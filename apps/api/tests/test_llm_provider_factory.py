import pytest

from app.openai_sop_provider import OpenAiSopProvider
from app.llm_provider_factory import get_llm_provider
from app.anthropic_sop_provider import AnthropicSopProvider

def test_get_llm_provider_defaults_to_openai(monkeypatch):
    monkeypatch.delenv("LLM_PROVIDER", raising=False)

    provider = get_llm_provider()

    assert isinstance(provider, OpenAiSopProvider)


def test_get_llm_provider_can_select_openai(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "openai")

    provider = get_llm_provider()

    assert isinstance(provider, OpenAiSopProvider)


def test_get_llm_provider_rejects_unknown_provider(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "unknown")

    with pytest.raises(RuntimeError, match="Unsupported LLM_PROVIDER"):
        get_llm_provider()

def test_get_llm_provider_can_select_anthropic(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "anthropic")

    provider = get_llm_provider()

    assert isinstance(provider, AnthropicSopProvider)