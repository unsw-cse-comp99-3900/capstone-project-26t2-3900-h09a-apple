from uuid import UUID

import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app.auth.deps import get_current_user, require_role
from app.auth.jwt import generate_token
from app.models import User, UserRole


class FakeQuery:
    def __init__(self, result):
        self._result = result

    def filter(self, *args, **kwargs):
        return self

    def first(self):
        return self._result


class FakeDb:
    def __init__(self, user):
        self._user = user

    def query(self, model):
        if model is User:
            return FakeQuery(self._user)
        return FakeQuery(None)


def _make_user() -> User:
    user = User()
    user.id = UUID("11111111-1111-1111-1111-111111111111")
    user.email = "employee@example.com"
    user.hashed_password = "hashed"
    user.role = UserRole.employee.value
    user.tenant_id = UUID("22222222-2222-2222-2222-222222222222")
    return user


def test_get_current_user_returns_user_from_db():
    user = _make_user()
    db = FakeDb(user)
    token = generate_token(user.id, UserRole.employee, user.tenant_id)
    credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)

    current_user = get_current_user(credentials, db)

    assert current_user is user
    assert current_user.email == "employee@example.com"


def test_get_current_user_raises_401_without_credentials():
    db = FakeDb(None)

    with pytest.raises(HTTPException) as exc_info:
        get_current_user(None, db)

    assert exc_info.value.status_code == 401


def test_get_current_user_raises_401_when_user_missing_from_db():
    user = _make_user()
    db = FakeDb(None)
    token = generate_token(user.id, UserRole.employee, user.tenant_id)
    credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)

    with pytest.raises(HTTPException) as exc_info:
        get_current_user(credentials, db)

    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "User not found"


def test_get_current_user_raises_401_for_invalid_token():
    db = FakeDb(None)
    credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials="not-a-jwt")

    with pytest.raises(HTTPException) as exc_info:
        get_current_user(credentials, db)

    assert exc_info.value.status_code == 401


def test_require_role_returns_user_when_role_matches():
    user = _make_user()
    dependency = require_role(UserRole.employee)

    assert dependency(user) is user


def test_require_role_raises_403_when_role_does_not_match():
    user = _make_user()
    user.role = UserRole.reviewer.value
    dependency = require_role(UserRole.employee)

    with pytest.raises(HTTPException) as exc_info:
        dependency(user)

    assert exc_info.value.status_code == 403
