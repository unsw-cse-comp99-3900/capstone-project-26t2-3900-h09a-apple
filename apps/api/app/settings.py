from __future__ import annotations

import os
from uuid import UUID

from dotenv import load_dotenv

load_dotenv()


class SettingsError(RuntimeError):
    pass


def get_default_tenant_id() -> UUID:
    raw_tenant_id = os.getenv("DEFAULT_TENANT_ID")
    if not raw_tenant_id:
        raise SettingsError("DEFAULT_TENANT_ID is not configured")

    try:
        return UUID(raw_tenant_id)
    except ValueError as exc:
        raise SettingsError("DEFAULT_TENANT_ID must be a valid UUID") from exc


def get_secret_key() -> str:
    secret_key = os.getenv("SECRET_KEY")
    if not secret_key:
        raise SettingsError("SECRET_KEY is not configured")
    return secret_key


def get_llm_provider() -> str:
    return os.getenv("LLM_PROVIDER", "mock").strip().lower()


def get_web_base_url() -> str:
    raw = os.getenv("WEB_BASE_URL", "").strip()
    if not raw:
        raise SettingsError("WEB_BASE_URL is not configured")
    return raw.rstrip("/")


def get_google_client_id() -> str:
    client_id = os.getenv("GOOGLE_CLIENT_ID")
    if not client_id:
        raise SettingsError("GOOGLE_CLIENT_ID is not configured")
    return client_id


def get_google_client_secret() -> str:
    client_secret = os.getenv("GOOGLE_CLIENT_SECRET")
    if not client_secret:
        raise SettingsError("GOOGLE_CLIENT_SECRET is not configured")
    return client_secret

def get_openai_api_key() -> str:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise SettingsError("OPENAI_API_KEY is not configured")
    return api_key


def get_openai_model() -> str:
    return os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip()