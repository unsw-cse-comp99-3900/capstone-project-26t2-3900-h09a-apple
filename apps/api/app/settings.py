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
