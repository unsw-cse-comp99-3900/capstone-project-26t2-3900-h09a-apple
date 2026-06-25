from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from jose import jwt

from app.auth.jwt import ALGORITHM, InvalidTokenError, generate_token, verify_token
from app.auth.password import hash_password, verify_password
from app.models import UserRole
from app.settings import get_secret_key


def test_hash_and_verify_password():
    hashed = hash_password("secret-password")
    assert hashed != "secret-password"
    assert verify_password("secret-password", hashed)
    assert not verify_password("wrong-password", hashed)


def test_generate_token_and_verify_round_trip():
    user_id = UUID("11111111-1111-1111-1111-111111111111")
    tenant_id = UUID("22222222-2222-2222-2222-222222222222")

    token = generate_token(user_id, UserRole.employee, tenant_id)
    payload = verify_token(token)

    assert payload["user_id"] == str(user_id)
    assert payload["role"] == "EMPLOYEE"
    assert payload["tenant_id"] == str(tenant_id)


def test_verify_token_rejects_expired_token():
    user_id = UUID("11111111-1111-1111-1111-111111111111")
    tenant_id = UUID("22222222-2222-2222-2222-222222222222")
    expire = datetime.now(UTC) - timedelta(hours=1)

    token = jwt.encode(
        {
            "user_id": str(user_id),
            "role": "EMPLOYEE",
            "tenant_id": str(tenant_id),
            "exp": expire,
        },
        get_secret_key(),
        algorithm=ALGORITHM,
    )

    with pytest.raises(InvalidTokenError):
        verify_token(token)


def test_verify_token_rejects_wrong_secret():
    user_id = UUID("11111111-1111-1111-1111-111111111111")
    token = jwt.encode(
        {
            "user_id": str(user_id),
            "role": "EMPLOYEE",
            "tenant_id": "22222222-2222-2222-2222-222222222222",
        },
        "wrong-secret-key",
        algorithm=ALGORITHM,
    )

    with pytest.raises(InvalidTokenError):
        verify_token(token)
