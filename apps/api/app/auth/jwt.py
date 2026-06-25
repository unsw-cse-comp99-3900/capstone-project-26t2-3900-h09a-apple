from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

from jose import JWTError, jwt

from app.models import UserRole
from app.settings import get_secret_key

ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = 24


class InvalidTokenError(Exception):
    pass


def generate_token(user_id: UUID, role: UserRole, tenant_id: UUID) -> str:
    expire = datetime.now(UTC) + timedelta(hours=TOKEN_EXPIRE_HOURS)
    payload = {
        "user_id": str(user_id),
        "role": role.value,
        "tenant_id": str(tenant_id),
        "exp": expire,
    }
    return jwt.encode(payload, get_secret_key(), algorithm=ALGORITHM)


def verify_token(token: str) -> dict[str, str]:
    try:
        payload = jwt.decode(token, get_secret_key(), algorithms=[ALGORITHM])
    except JWTError as exc:
        raise InvalidTokenError("Invalid or expired token") from exc

    user_id = payload.get("user_id")
    if not user_id:
        raise InvalidTokenError("Token missing user_id")

    return {
        "user_id": str(user_id),
        "role": str(payload.get("role", "")),
        "tenant_id": str(payload.get("tenant_id", "")),
    }
