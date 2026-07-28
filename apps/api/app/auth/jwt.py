from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from jose import JWTError, jwt

from app.models import UserRole
from app.settings import get_secret_key

ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = 24
REFRESH_TOKEN_EXPIRE_DAYS = 7
ACCESS_TOKEN_EXPIRE_SECONDS = TOKEN_EXPIRE_HOURS * 3600

TOKEN_TYPE_ACCESS = "access"
TOKEN_TYPE_REFRESH = "refresh"
TOKEN_TYPE_WS = "ws"
WS_TOKEN_EXPIRE_SECONDS = 60


class InvalidTokenError(Exception):
    pass


@dataclass(frozen=True)
class IssuedRefreshToken:
    token: str
    jti: UUID
    expires_at: datetime


def _encode_token(payload: dict) -> str:
    return jwt.encode(payload, get_secret_key(), algorithm=ALGORITHM)


def generate_token(user_id: UUID, role: UserRole, tenant_id: UUID) -> str:
    expire = datetime.now(UTC) + timedelta(hours=TOKEN_EXPIRE_HOURS)
    payload = {
        "user_id": str(user_id),
        "role": role.value,
        "tenant_id": str(tenant_id),
        "type": TOKEN_TYPE_ACCESS,
        "exp": expire,
    }
    return _encode_token(payload)


def generate_ws_ticket(user_id: UUID, role: UserRole, tenant_id: UUID) -> str:
    expire = datetime.now(UTC) + timedelta(seconds=WS_TOKEN_EXPIRE_SECONDS)
    payload = {
        "user_id": str(user_id),
        "role": role.value,
        "tenant_id": str(tenant_id),
        "type": TOKEN_TYPE_WS,
        "exp": expire,
    }
    return _encode_token(payload)


def generate_refresh_token(user_id: UUID, role: UserRole, tenant_id: UUID) -> IssuedRefreshToken:
    jti = uuid4()
    expire = datetime.now(UTC) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    payload = {
        "user_id": str(user_id),
        "role": role.value,
        "tenant_id": str(tenant_id),
        "type": TOKEN_TYPE_REFRESH,
        "jti": str(jti),
        "exp": expire,
    }
    return IssuedRefreshToken(
        token=_encode_token(payload),
        jti=jti,
        expires_at=expire,
    )


def _decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, get_secret_key(), algorithms=[ALGORITHM])
    except JWTError as exc:
        raise InvalidTokenError("Invalid or expired token") from exc


def _token_identity(payload: dict) -> dict[str, str]:
    user_id = payload.get("user_id")
    if not user_id:
        raise InvalidTokenError("Token missing user_id")

    return {
        "user_id": str(user_id),
        "role": str(payload.get("role", "")),
        "tenant_id": str(payload.get("tenant_id", "")),
    }


def verify_token(token: str) -> dict[str, str]:
    payload = _decode_token(token)
    token_type = payload.get("type")
    if token_type is not None and token_type != TOKEN_TYPE_ACCESS:
        raise InvalidTokenError("Invalid or expired token")
    return _token_identity(payload)


def verify_access_or_ws_token(token: str) -> dict[str, str]:
    payload = _decode_token(token)
    token_type = payload.get("type")
    if token_type not in {None, TOKEN_TYPE_ACCESS, TOKEN_TYPE_WS}:
        raise InvalidTokenError("Invalid or expired token")
    return _token_identity(payload)


def verify_refresh_token(token: str) -> dict[str, str]:
    payload = _decode_token(token)
    if payload.get("type") != TOKEN_TYPE_REFRESH:
        raise InvalidTokenError("Invalid or expired token")

    jti = payload.get("jti")
    if not jti:
        raise InvalidTokenError("Invalid or expired token")

    identity = _token_identity(payload)
    identity["jti"] = str(jti)
    return identity
