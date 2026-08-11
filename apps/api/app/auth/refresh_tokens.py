"""
Persisted refresh-token rows with rotation and revocation.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy.orm import Session as DBSession

from app.auth.jwt import IssuedRefreshToken, generate_refresh_token
from app.models import RefreshToken, User, UserRole


def store_refresh_token(db: DBSession, issued: IssuedRefreshToken, user_id: UUID) -> None:
    db.add(
        RefreshToken(
            jti=issued.jti,
            user_id=user_id,
            expires_at=issued.expires_at,
            revoked_at=None,
        )
    )


def issue_refresh_token(db: DBSession, user: User, role: UserRole) -> str:
    issued = generate_refresh_token(user.id, role, user.tenant_id)
    store_refresh_token(db, issued, user.id)
    db.commit()
    return issued.token


def get_active_refresh_token(db: DBSession, jti: UUID) -> RefreshToken | None:
    row = db.query(RefreshToken).filter(RefreshToken.jti == jti).first()
    if row is None or row.revoked_at is not None:
        return None
    return row


def revoke_refresh_token(db: DBSession, jti: UUID, *, commit: bool = True) -> bool:
    row = db.query(RefreshToken).filter(RefreshToken.jti == jti).first()
    if row is None or row.revoked_at is not None:
        return False
    row.revoked_at = datetime.now(UTC)
    if commit:
        db.commit()
    return True


def revoke_all_refresh_tokens_for_user(
    db: DBSession,
    user_id: UUID,
    *,
    commit: bool = True,
) -> int:
    now = datetime.now(UTC)
    revoked = 0
    rows = db.query(RefreshToken).filter(RefreshToken.user_id == user_id).all()
    for row in rows:
        if row.revoked_at is None:
            row.revoked_at = now
            revoked += 1
    if revoked and commit:
        db.commit()
    return revoked
