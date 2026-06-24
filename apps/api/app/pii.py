from __future__ import annotations

import re
from typing import Any

from app.session_schema import SessionPayload

EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
PHONE_RE = re.compile(r"\b(?:\+?61|0)[2-478](?:[ -]?\d){8}\b")
TOKEN_RE = re.compile(r"\b(token|password|secret|api_key)=([^&\s]+)", re.IGNORECASE)


def mask_pii(value: str) -> str:
    value = EMAIL_RE.sub("[EMAIL]", value)
    value = PHONE_RE.sub("[PHONE]", value)
    value = TOKEN_RE.sub(r"\1=[REDACTED]", value)
    return value


def mask_value(value: Any) -> Any:
    if isinstance(value, str):
        return mask_pii(value)

    if isinstance(value, list):
        return [mask_value(item) for item in value]

    if isinstance(value, dict):
        return {key: mask_value(item) for key, item in value.items()}

    return value


def mask_session_payload(payload: SessionPayload) -> SessionPayload:
    masked_payload = payload.model_copy(deep=True)

    for event in masked_payload.events:
        event.target_selector = mask_value(event.target_selector)
        event.target_label = mask_value(event.target_label)
        event.value = mask_value(event.value)
        event.url = mask_value(event.url)
        event.attrs = mask_value(event.attrs)

    return masked_payload
