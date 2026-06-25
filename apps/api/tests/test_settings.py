from uuid import UUID

import pytest

from app.settings import SettingsError, get_default_tenant_id, get_secret_key


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
