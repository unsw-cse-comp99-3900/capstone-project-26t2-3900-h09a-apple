from uuid import UUID

import pytest

from app.settings import (
    SettingsError,
    get_default_tenant_id,
    get_google_client_id,
    get_google_client_secret,
    get_openai_api_key,
    get_openai_model,
    get_secret_key,
    get_web_base_url,
)


def test_get_default_tenant_id_requires_env_var(monkeypatch):
    monkeypatch.delenv("DEFAULT_TENANT_ID", raising=False)

    with pytest.raises(SettingsError, match="DEFAULT_TENANT_ID is not configured"):
        get_default_tenant_id()


def test_get_default_tenant_id_requires_valid_uuid(monkeypatch):
    monkeypatch.setenv("DEFAULT_TENANT_ID", "not-a-uuid")

    with pytest.raises(SettingsError, match="DEFAULT_TENANT_ID must be a valid UUID"):
        get_default_tenant_id()


def test_get_default_tenant_id_returns_uuid(monkeypatch):
    monkeypatch.setenv("DEFAULT_TENANT_ID", "22222222-2222-2222-2222-222222222222")

    assert get_default_tenant_id() == UUID("22222222-2222-2222-2222-222222222222")


def test_get_secret_key_requires_env_var(monkeypatch):
    monkeypatch.delenv("SECRET_KEY", raising=False)

    with pytest.raises(SettingsError, match="SECRET_KEY is not configured"):
        get_secret_key()


def test_get_secret_key_returns_value(monkeypatch):
    monkeypatch.setenv("SECRET_KEY", "my-secret")

    assert get_secret_key() == "my-secret"


def test_get_web_base_url_requires_env_var(monkeypatch):
    monkeypatch.delenv("WEB_BASE_URL", raising=False)

    with pytest.raises(SettingsError, match="WEB_BASE_URL is not configured"):
        get_web_base_url()


def test_get_web_base_url_strips_trailing_slash(monkeypatch):
    monkeypatch.setenv("WEB_BASE_URL", "http://localhost:3000/")

    assert get_web_base_url() == "http://localhost:3000"


def test_get_google_client_id_requires_env(monkeypatch):
    monkeypatch.delenv("GOOGLE_CLIENT_ID", raising=False)
    with pytest.raises(SettingsError, match="GOOGLE_CLIENT_ID is not configured"):
        get_google_client_id()


def test_get_google_client_id_returns_value(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "gid")
    assert get_google_client_id() == "gid"


def test_get_google_client_secret_requires_env(monkeypatch):
    monkeypatch.delenv("GOOGLE_CLIENT_SECRET", raising=False)
    with pytest.raises(SettingsError, match="GOOGLE_CLIENT_SECRET is not configured"):
        get_google_client_secret()


def test_get_google_client_secret_returns_value(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "gsecret")
    assert get_google_client_secret() == "gsecret"


def test_get_openai_api_key_requires_env(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with pytest.raises(SettingsError, match="OPENAI_API_KEY is not configured"):
        get_openai_api_key()


def test_get_openai_api_key_returns_value(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    assert get_openai_api_key() == "sk-test"


def test_get_openai_model_default_and_override(monkeypatch):
    monkeypatch.delenv("OPENAI_MODEL", raising=False)
    assert get_openai_model() == "gpt-4o-mini"
    monkeypatch.setenv("OPENAI_MODEL", " gpt-4o ")
    assert get_openai_model() == "gpt-4o"
