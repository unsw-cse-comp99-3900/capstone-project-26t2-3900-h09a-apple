"""
Password hashing and verification (bcrypt via passlib).
"""

from __future__ import annotations

from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

_DUMMY_HASH: str | None = None


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def _dummy_hash() -> str:
    global _DUMMY_HASH
    if _DUMMY_HASH is None:
        _DUMMY_HASH = pwd_context.hash("timing-equalization-dummy")
    return _DUMMY_HASH


def verify_login_password(plain_password: str, hashed_password: str | None) -> bool:
    """Verify password; run bcrypt even when user is missing to reduce timing oracle."""
    target_hash = hashed_password if hashed_password is not None else _dummy_hash()
    if not verify_password(plain_password, target_hash):
        return False
    return hashed_password is not None
