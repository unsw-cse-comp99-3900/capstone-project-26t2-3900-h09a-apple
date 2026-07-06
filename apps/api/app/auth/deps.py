from __future__ import annotations

from collections.abc import Callable
from typing import Annotated, Any, Type
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Query
from sqlalchemy.orm import Session as DBSession

from app.auth.jwt import InvalidTokenError, verify_token
from app.database import get_db
from app.models import User, UserRole

_bearer = HTTPBearer(auto_error=False)
_UNAUTHORIZED_HEADERS = {"WWW-Authenticate": "Bearer"}

_ROLE_RANK: dict[UserRole, int] = {
    UserRole.employee: 0,
    UserRole.reviewer: 1,
    UserRole.manager: 2,
}


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    db: Annotated[DBSession, Depends(get_db)],
) -> User:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers=_UNAUTHORIZED_HEADERS,
        )

    try:
        payload = verify_token(credentials.credentials)
        user_id = UUID(payload["user_id"])
    except (InvalidTokenError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers=_UNAUTHORIZED_HEADERS,
        ) from None

    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers=_UNAUTHORIZED_HEADERS,
        )

    return user


def _role_at_least(user_role: UserRole, minimum_role: UserRole) -> bool:
    return _ROLE_RANK[user_role] >= _ROLE_RANK[minimum_role]


def require_role(minimum_role: UserRole) -> Callable[..., User]:
    def dependency(
        current_user: Annotated[User, Depends(get_current_user)],
    ) -> User:
        try:
            user_role = UserRole(current_user.role)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Invalid user role",
            ) from None

        if not _role_at_least(user_role, minimum_role):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"{minimum_role.value} role or higher required",
            )
        return current_user

    return dependency


def filter_by_tenant(
    query: Query,
    model: Type[Any],
    tenant_id: UUID | str,
) -> Query:
    """Apply tenant filter. tenant_id must be a UUID or UUID-formatted string."""
    if isinstance(tenant_id, str):
        try:
            tenant_id = UUID(tenant_id)
        except ValueError as exc:
            raise ValueError("tenant_id must be a valid UUID") from exc
    return query.filter(model.tenant_id == tenant_id)
