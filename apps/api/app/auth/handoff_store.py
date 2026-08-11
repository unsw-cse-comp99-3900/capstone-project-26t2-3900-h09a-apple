"""
Short-lived codes that hand a web login session to the extension.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from secrets import token_urlsafe
from uuid import UUID

HANDOFF_CODE_EXPIRE_SECONDS = 60


class HandoffCodeError(Exception):
    """Raised when a handoff code is missing, expired, or already redeemed."""


@dataclass
class HandoffEntry:
    user_id: UUID
    expires_at: datetime
    used_at: datetime | None = None


_store: dict[str, HandoffEntry] = {}


def _purge_expired(now: datetime | None = None) -> None:
    current = now or datetime.now(UTC)
    expired_codes = [code for code, entry in _store.items() if entry.expires_at <= current]
    for code in expired_codes:
        _store.pop(code, None)


def create_handoff_code(user_id: UUID) -> str:
    _purge_expired()
    code = token_urlsafe(32)
    _store[code] = HandoffEntry(
        user_id=user_id,
        expires_at=datetime.now(UTC) + timedelta(seconds=HANDOFF_CODE_EXPIRE_SECONDS),
    )
    return code


def redeem_handoff_code(code: str) -> UUID:
    _purge_expired()
    entry = _store.get(code)
    if entry is None or entry.used_at is not None or entry.expires_at <= datetime.now(UTC):
        raise HandoffCodeError("Invalid or expired handoff code")
    entry.used_at = datetime.now(UTC)
    return entry.user_id


def clear_handoff_store() -> None:
    _store.clear()
