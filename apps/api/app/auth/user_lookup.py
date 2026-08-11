"""
Shared user lookup helpers used by auth and handoff flows.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.orm import Session as DBSession

from app.models import User

# Sentinel PK lookup so login always performs two indexed queries.
_NULL_USER_ID = UUID("00000000-0000-0000-0000-000000000000")


def find_user_by_email(db: DBSession, email: str) -> User | None:
    user = db.query(User).filter(User.email == email).first()
    db.query(User).filter(User.id == _NULL_USER_ID).first()
    return user


def touch_user_lookup(db: DBSession) -> None:
    """No-op PK lookup to align DB timing on register duplicate vs success paths."""
    db.query(User).filter(User.id == _NULL_USER_ID).first()
