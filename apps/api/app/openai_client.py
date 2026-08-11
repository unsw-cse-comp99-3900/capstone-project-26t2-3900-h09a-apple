"""
Shared OpenAI-compatible client factory (OpenAI or Azure-style base).
"""

from __future__ import annotations

import os

from openai import OpenAI

OPENROUTER_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"


def _resolve_api_key() -> str | None:
    return os.getenv("OPENAI_API_KEY") or os.getenv("OPENROUTER_API_KEY")


def _resolve_base_url() -> str | None:
    base_url = os.getenv("OPENAI_BASE_URL") or os.getenv("OPENROUTER_BASE_URL")
    if base_url:
        return base_url.rstrip("/")

    if os.getenv("OPENROUTER_API_KEY") and not os.getenv("OPENAI_API_KEY"):
        return OPENROUTER_DEFAULT_BASE_URL

    return None


def _openrouter_headers(base_url: str | None) -> dict[str, str] | None:
    if not base_url or "openrouter.ai" not in base_url:
        return None

    return {
        "HTTP-Referer": os.getenv("OPENROUTER_SITE_URL", "http://localhost:3000"),
        "X-Title": os.getenv("OPENROUTER_APP_NAME", "WorkTrace"),
    }


def create_openai_compatible_client() -> OpenAI:
    api_key = _resolve_api_key()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY or OPENROUTER_API_KEY is not configured")

    base_url = _resolve_base_url()
    kwargs: dict[str, object] = {"api_key": api_key}
    if base_url:
        kwargs["base_url"] = base_url

    headers = _openrouter_headers(base_url)
    if headers:
        kwargs["default_headers"] = headers

    return OpenAI(**kwargs)
