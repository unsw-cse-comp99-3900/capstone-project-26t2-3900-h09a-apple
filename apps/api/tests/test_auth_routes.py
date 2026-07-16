from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from jose import jwt
import app.auth.routes as auth_routes
from app.auth.rate_limit import clear_auth_rate_limit_state

from app.auth.jwt import (
    ACCESS_TOKEN_EXPIRE_SECONDS,
    ALGORITHM,
    REFRESH_TOKEN_EXPIRE_DAYS,
    TOKEN_TYPE_ACCESS,
    TOKEN_TYPE_REFRESH,
    InvalidTokenError,
    generate_refresh_token,
    generate_token,
    verify_refresh_token,
    verify_token,
)
from app.auth.password import hash_password
from app.database import get_db
from app.main import app
from app.models import User, UserRole
from app.settings import get_secret_key

client = TestClient(app)

TENANT_ID = UUID("22222222-2222-2222-2222-222222222222")
OTHER_TENANT_ID = UUID("33333333-3333-3333-3333-333333333333")

def _matches_criterion(item: User, criterion) -> bool:
    left_key = criterion.left.key
    right = criterion.right
    value = right.value if hasattr(right, "value") else right
    return getattr(item, left_key) == value


class UserQuery:
    def __init__(self, users: list[User]):
        self._users = users
        self._criteria: list = []

    def filter(self, *criteria):
        self._criteria.extend(criteria)
        return self

    def first(self):
        for user in self._users:
            if all(_matches_criterion(user, criterion) for criterion in self._criteria):
                return user
        return None


class AuthFakeDb:
    def __init__(self, users: list[User] | None = None):
        self.users = list(users or [])
        self.pending: list[User] = []
        self.committed = False
        self.rolled_back = False

    def query(self, model):
        if model is User:
            return UserQuery(self.users)
        return UserQuery([])

    def add(self, item):
        self.pending.append(item)

    def flush(self):
        for user in self.pending:
            if user.id is None:
                user.id = uuid4()
            if user not in self.users:
                self.users.append(user)
        self.pending.clear()

    def commit(self):
        self.flush()
        self.committed = True

    def rollback(self):
        self.pending.clear()
        self.rolled_back = True


@pytest.fixture
def auth_db(monkeypatch):
    monkeypatch.setenv("DEFAULT_TENANT_ID", str(TENANT_ID))
    monkeypatch.setenv("AUTH_RATE_LIMIT_DISABLED", "true")
    monkeypatch.setattr(auth_routes, "get_default_tenant_id", lambda: TENANT_ID)
    clear_auth_rate_limit_state()

    db = AuthFakeDb()
    had_previous = get_db in app.dependency_overrides
    previous = app.dependency_overrides.get(get_db)

    def _override():
        yield db

    app.dependency_overrides[get_db] = _override

    try:
        yield db
    finally:
        clear_auth_rate_limit_state()
        if had_previous:
            app.dependency_overrides[get_db] = previous
        else:
            app.dependency_overrides.pop(get_db, None)


def register_payload(**overrides) -> dict:
    payload = {
        "email": "newuser@example.com",
        "password": "secret-password", 
    }
    payload.update(overrides)
    return payload


def test_register_returns_201_with_user_id_and_role(auth_db):
    response = client.post("/api/v1/auth/register", json=register_payload())

    assert response.status_code == 201
    body = response.json()
    assert body["role"] == "EMPLOYEE"
    assert body["user_id"]
    assert "password" not in body
    assert auth_db.committed
    user = auth_db.users[0]
    assert user.role == UserRole.employee.value
    assert user.tenant_id == TENANT_ID


def test_register_ignores_client_supplied_role_and_tenant(auth_db):
    response = client.post(
        "/api/v1/auth/register",
        json=register_payload(
            role=UserRole.manager.value,
            tenant_id=str(OTHER_TENANT_ID),
        ),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["role"] == UserRole.employee.value
    user = auth_db.users[0]
    assert user.role == UserRole.employee.value
    assert user.tenant_id == TENANT_ID

def test_register_returns_409_for_duplicate_email_in_tenant(auth_db):
    auth_db.users.append(
        User(
            id=uuid4(),
            email="newuser@example.com",
            hashed_password="hashed",
            role=UserRole.employee.value,
            tenant_id=TENANT_ID,
        )
    )

    response = client.post("/api/v1/auth/register", json=register_payload())

    assert response.status_code == 409
    assert response.json()["detail"] == "Registration failed"


def test_register_returns_409_for_normalized_duplicate_email_in_tenant(auth_db):
    response = client.post(
        "/api/v1/auth/register",
        json=register_payload(email="User@Example.COM"),
    )
    assert response.status_code == 201

    response = client.post(
        "/api/v1/auth/register",
        json=register_payload(email="user@example.com"),
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "Registration failed"


def test_login_accepts_normalized_email(auth_db):
    password = "secret-password"
    auth_db.users.append(
        User(
            id=uuid4(),
            email="user@example.com",
            hashed_password=hash_password(password),
            role=UserRole.employee.value,
            tenant_id=TENANT_ID,
        )
    )

    response = client.post(
        "/api/v1/auth/login",
        json={"email": "  User@Example.COM  ", "password": password},
    )

    assert response.status_code == 200
    assert response.json()["access_token"]


def test_login_returns_tokens_for_valid_credentials(auth_db):
    password = "secret-password"
    user = User(
        id=UUID("11111111-1111-1111-1111-111111111111"),
        email="employee@example.com",
        hashed_password=hash_password(password),
        role=UserRole.employee.value,
        tenant_id=TENANT_ID,
    )
    auth_db.users.append(user)

    response = client.post(
        "/api/v1/auth/login",
        json={"email": "employee@example.com", "password": password},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["expires_in"] == ACCESS_TOKEN_EXPIRE_SECONDS
    assert body["access_token"]
    assert body["refresh_token"]
    assert "password" not in body

    access_payload = verify_token(body["access_token"])
    assert access_payload["user_id"] == str(user.id)

    refresh_payload = verify_refresh_token(body["refresh_token"])
    assert refresh_payload["user_id"] == str(user.id)


def test_login_returns_401_for_wrong_password(auth_db):
    user = User(
        id=uuid4(),
        email="employee@example.com",
        hashed_password=hash_password("secret-password"),
        role=UserRole.employee.value,
        tenant_id=TENANT_ID,
    )
    auth_db.users.append(user)

    response = client.post(
        "/api/v1/auth/login",
        json={"email": "employee@example.com", "password": "wrong-password"},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid credentials"


def test_login_returns_401_for_unknown_email(auth_db):
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "missing@example.com", "password": "secret-password"},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid credentials"


def test_refresh_returns_new_access_token(auth_db):
    user = User(
        id=UUID("11111111-1111-1111-1111-111111111111"),
        email="employee@example.com",
        hashed_password=hash_password("secret-password"),
        role=UserRole.reviewer.value,
        tenant_id=TENANT_ID,
    )
    auth_db.users.append(user)
    refresh_token = generate_refresh_token(user.id, UserRole.reviewer, user.tenant_id)

    response = client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})

    assert response.status_code == 200
    body = response.json()
    assert body["expires_in"] == ACCESS_TOKEN_EXPIRE_SECONDS
    assert body["access_token"]

    payload = verify_token(body["access_token"])
    assert payload["user_id"] == str(user.id)
    assert payload["role"] == "REVIEWER"


def test_refresh_returns_401_for_access_token(auth_db):
    user = User(
        id=uuid4(),
        email="employee@example.com",
        hashed_password="hashed",
        role=UserRole.employee.value,
        tenant_id=TENANT_ID,
    )
    auth_db.users.append(user)
    access_token = generate_token(user.id, UserRole.employee, user.tenant_id)

    response = client.post("/api/v1/auth/refresh", json={"refresh_token": access_token})

    assert response.status_code == 401


def test_refresh_returns_401_for_expired_refresh_token():
    user_id = UUID("11111111-1111-1111-1111-111111111111")
    expire = datetime.now(UTC) - timedelta(days=1)
    token = jwt.encode(
        {
            "user_id": str(user_id),
            "role": "EMPLOYEE",
            "tenant_id": str(TENANT_ID),
            "type": TOKEN_TYPE_REFRESH,
            "exp": expire,
        },
        get_secret_key(),
        algorithm=ALGORITHM,
    )

    response = client.post("/api/v1/auth/refresh", json={"refresh_token": token})

    assert response.status_code == 401


def test_generate_refresh_token_has_refresh_type():
    user_id = UUID("11111111-1111-1111-1111-111111111111")
    token = generate_refresh_token(user_id, UserRole.employee, TENANT_ID)
    payload = jwt.decode(token, get_secret_key(), algorithms=[ALGORITHM])

    assert payload["type"] == TOKEN_TYPE_REFRESH
    assert payload["user_id"] == str(user_id)


def test_verify_token_rejects_refresh_token():
    user_id = UUID("11111111-1111-1111-1111-111111111111")
    token = generate_refresh_token(user_id, UserRole.employee, TENANT_ID)

    with pytest.raises(InvalidTokenError):
        verify_token(token)


def test_access_token_has_access_type():
    user_id = UUID("11111111-1111-1111-1111-111111111111")
    token = generate_token(user_id, UserRole.employee, TENANT_ID)
    payload = jwt.decode(token, get_secret_key(), algorithms=[ALGORITHM])

    assert payload["type"] == TOKEN_TYPE_ACCESS


def test_refresh_token_expires_in_seven_days():
    user_id = UUID("11111111-1111-1111-1111-111111111111")
    before = datetime.now(UTC)
    token = generate_refresh_token(user_id, UserRole.employee, TENANT_ID)
    payload = jwt.decode(token, get_secret_key(), algorithms=[ALGORITHM])
    exp = datetime.fromtimestamp(payload["exp"], UTC)

    expected_min = before + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS) - timedelta(minutes=1)
    expected_max = before + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS) + timedelta(minutes=1)
    assert expected_min <= exp <= expected_max


def test_auth_rate_limit_returns_429(monkeypatch, auth_db):
    from app.auth.rate_limit import clear_auth_rate_limit_state

    clear_auth_rate_limit_state()
    monkeypatch.setenv("AUTH_RATE_LIMIT_MAX", "2")
    monkeypatch.setenv("AUTH_RATE_LIMIT_WINDOW_SECONDS", "60")
    monkeypatch.delenv("AUTH_RATE_LIMIT_DISABLED", raising=False)

    payload = {"email": "missing@example.com", "password": "secret-password"}
    assert client.post("/api/v1/auth/login", json=payload).status_code == 401
    assert client.post("/api/v1/auth/login", json=payload).status_code == 401
    response = client.post("/api/v1/auth/login", json=payload)
    assert response.status_code == 429
    assert response.json()["detail"] == "Too many requests"

    clear_auth_rate_limit_state()


def test_auth_me_returns_current_user(auth_db):
    user = User(
        id=UUID("11111111-1111-1111-1111-111111111111"),
        email="employee@example.com",
        hashed_password=hash_password("secret-password"),
        role=UserRole.employee.value,
        tenant_id=TENANT_ID,
    )
    auth_db.users.append(user)
    token = generate_token(user.id, UserRole.employee, user.tenant_id)

    response = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == str(user.id)
    assert body["email"] == user.email
    assert body["role"] == user.role
    assert body["tenant_id"] == str(user.tenant_id)


def test_auth_me_returns_401_without_token():
    response = client.get("/api/v1/auth/me")

    assert response.status_code == 401


def test_extension_handoff_mint_requires_auth():
    response = client.post("/api/v1/auth/extension-handoff")

    assert response.status_code == 401


def test_extension_handoff_mint_returns_code(auth_db):
    from app.auth.handoff_store import clear_handoff_store

    clear_handoff_store()
    user = User(
        id=UUID("11111111-1111-1111-1111-111111111111"),
        email="employee@example.com",
        hashed_password=hash_password("secret-password"),
        role=UserRole.employee.value,
        tenant_id=TENANT_ID,
    )
    auth_db.users.append(user)
    token = generate_token(user.id, UserRole.employee, user.tenant_id)

    response = client.post(
        "/api/v1/auth/extension-handoff",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["code"]
    assert body["expires_in"] == 60


def test_extension_handoff_redeem_returns_tokens(auth_db):
    from app.auth.handoff_store import clear_handoff_store, create_handoff_code

    clear_handoff_store()
    user = User(
        id=UUID("11111111-1111-1111-1111-111111111111"),
        email="employee@example.com",
        hashed_password=hash_password("secret-password"),
        role=UserRole.employee.value,
        tenant_id=TENANT_ID,
    )
    auth_db.users.append(user)
    code = create_handoff_code(user.id)

    response = client.post("/api/v1/auth/extension-handoff/redeem", json={"code": code})

    assert response.status_code == 200
    body = response.json()
    assert body["access_token"]
    assert body["refresh_token"]
    assert body["expires_in"] == ACCESS_TOKEN_EXPIRE_SECONDS


def test_extension_handoff_redeem_rejects_reused_code(auth_db):
    from app.auth.handoff_store import clear_handoff_store, create_handoff_code

    clear_handoff_store()
    user = User(
        id=UUID("11111111-1111-1111-1111-111111111111"),
        email="employee@example.com",
        hashed_password=hash_password("secret-password"),
        role=UserRole.employee.value,
        tenant_id=TENANT_ID,
    )
    auth_db.users.append(user)
    code = create_handoff_code(user.id)

    first = client.post("/api/v1/auth/extension-handoff/redeem", json={"code": code})
    second = client.post("/api/v1/auth/extension-handoff/redeem", json={"code": code})

    assert first.status_code == 200
    assert second.status_code == 401


def test_extension_handoff_redeem_rejects_expired_code(auth_db):
    from datetime import UTC, datetime, timedelta

    from app.auth.handoff_store import HandoffEntry, _store, clear_handoff_store

    clear_handoff_store()
    user = User(
        id=UUID("11111111-1111-1111-1111-111111111111"),
        email="employee@example.com",
        hashed_password=hash_password("secret-password"),
        role=UserRole.employee.value,
        tenant_id=TENANT_ID,
    )
    auth_db.users.append(user)
    code = "expired-code"
    _store[code] = HandoffEntry(
        user_id=user.id,
        expires_at=datetime.now(UTC) - timedelta(seconds=1),
    )

    response = client.post("/api/v1/auth/extension-handoff/redeem", json={"code": code})

    assert response.status_code == 401
