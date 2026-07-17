from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy.orm import Session as DBSession

from app.auth.password import hash_password
from app.auth.refresh_tokens import revoke_all_refresh_tokens_for_user
from app.models import PasswordResetToken, User
from app.settings import get_secret_key

PASSWORD_RESET_TOKEN_EXPIRE_MINUTES = 30


def hash_reset_token(raw_token: str) -> str:
    material = f"{get_secret_key()}:{raw_token}".encode()
    return hashlib.sha256(material).hexdigest()


def create_reset_token(db: DBSession, user: User) -> str:
    raw_token = secrets.token_urlsafe(32)
    token_hash = hash_reset_token(raw_token)
    db.add(
        PasswordResetToken(
            user_id=user.id,
            token_hash=token_hash,
            expires_at=datetime.now(UTC) + timedelta(minutes=PASSWORD_RESET_TOKEN_EXPIRE_MINUTES),
            used_at=None,
        )
    )
    db.commit()
    return raw_token


def consume_reset_token(db: DBSession, raw_token: str, new_password: str) -> UUID | None:
    """Validate token, set password, mark used, revoke refresh sessions.

    Returns the user id on success, or None when the token is invalid/expired/used.
    """
    token_hash = hash_reset_token(raw_token)
    row = db.query(PasswordResetToken).filter(PasswordResetToken.token_hash == token_hash).first()
    if row is None or row.used_at is not None:
        return None

    expires_at = row.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    if expires_at <= datetime.now(UTC):
        return None

    user = db.query(User).filter(User.id == row.user_id).first()
    if user is None:
        return None

    user.hashed_password = hash_password(new_password)
    row.used_at = datetime.now(UTC)
    revoke_all_refresh_tokens_for_user(db, user.id, commit=False)
    db.commit()
    return user.id
