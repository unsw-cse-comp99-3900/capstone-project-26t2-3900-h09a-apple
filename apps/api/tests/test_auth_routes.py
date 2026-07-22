from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from jose import jwt

import app.auth.routes as auth_routes
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
from app.auth.password import hash_password, verify_password
from app.auth.password_reset import hash_reset_token
from app.auth.rate_limit import clear_auth_rate_limit_state
from app.auth.refresh_tokens import issue_refresh_token
from app.database import get_db
from app.email import clear_mock_email_outbox, get_mock_email_outbox
from app.email.sender import build_password_reset_email
from app.main import app
from app.models import PasswordResetToken, RefreshToken, User, UserRole
from app.settings import get_secret_key

client = TestClient(app)

TENANT_ID = UUID("22222222-2222-2222-2222-222222222222")
OTHER_TENANT_ID = UUID("33333333-3333-3333-3333-333333333333")


def _matches_criterion(item, criterion) -> bool:
    left_key = criterion.left.key
    right = criterion.right
    value = right.value if hasattr(right, "value") else right
    return getattr(item, left_key) == value


class ModelQuery:
    def __init__(self, items: list):
        self._items = items
        self._criteria: list = []

    def filter(self, *criteria):
        self._criteria.extend(criteria)
        return self

    def first(self):
        matched = self.all()
        return matched[0] if matched else None

    def all(self):
        return [
            item
            for item in self._items
            if all(_matches_criterion(item, criterion) for criterion in self._criteria)
        ]


class AuthFakeDb:
    def __init__(self, users: list[User] | None = None):
        self.users = list(users or [])
        self.refresh_tokens: list[RefreshToken] = []
        self.password_reset_tokens: list[PasswordResetToken] = []
        self.pending: list = []
        self.committed = False
        self.rolled_back = False

    def query(self, model):
        if model is User:
            return ModelQuery(self.users)
        if model is RefreshToken:
            return ModelQuery(self.refresh_tokens)
        if model is PasswordResetToken:
            return ModelQuery(self.password_reset_tokens)
        return ModelQuery([])

    def add(self, item):
        self.pending.append(item)

    def flush(self):
        for item in self.pending:
            if getattr(item, "id", None) is None:
                item.id = uuid4()
            if isinstance(item, User) and item not in self.users:
                self.users.append(item)
            elif isinstance(item, RefreshToken) and item not in self.refresh_tokens:
                self.refresh_tokens.append(item)
            elif isinstance(item, PasswordResetToken) and item not in self.password_reset_tokens:
                self.password_reset_tokens.append(item)
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
    monkeypatch.setenv("WEB_BASE_URL", "http://localhost:3000")
    monkeypatch.setenv("EMAIL_PROVIDER", "mock")
    monkeypatch.setenv("AUTH_RATE_LIMIT_DISABLED", "true")
    monkeypatch.setattr(auth_routes, "get_default_tenant_id", lambda: TENANT_ID)
    clear_auth_rate_limit_state()
    clear_mock_email_outbox()

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
        clear_mock_email_outbox()
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


def _employee(email: str = "employee@example.com", password: str = "secret-password") -> User:
    return User(
        id=UUID("11111111-1111-1111-1111-111111111111"),
        email=email,
        hashed_password=hash_password(password),
        role=UserRole.employee.value,
        tenant_id=TENANT_ID,
    )


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
    user = _employee(password=password)
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
    assert len(auth_db.refresh_tokens) == 1

    access_payload = verify_token(body["access_token"])
    assert access_payload["user_id"] == str(user.id)

    refresh_payload = verify_refresh_token(body["refresh_token"])
    assert refresh_payload["user_id"] == str(user.id)
    assert refresh_payload["jti"] == str(auth_db.refresh_tokens[0].jti)


def test_google_callback_logs_into_existing_password_account(auth_db, monkeypatch):
    user = User(
        id=UUID("11111111-1111-1111-1111-111111111111"),
        email="employee@example.com",
        hashed_password=hash_password("secret-password"),
        role=UserRole.reviewer.value,
        tenant_id=TENANT_ID,
    )
    auth_db.users.append(user)

    monkeypatch.setattr(auth_routes, "exchange_google_code_for_id_token", lambda *_: "id-token")
    monkeypatch.setattr(
        auth_routes,
        "verify_google_id_token",
        lambda _: SimpleNamespace(email="employee@example.com"),
    )

    response = client.post(
        "/api/v1/auth/google/callback",
        json={
            "code": "auth-code",
            "redirect_uri": "http://localhost:3000/api/auth/google/callback",
        },
    )

    assert response.status_code == 200
    assert len(auth_db.users) == 1

    payload = verify_token(response.json()["access_token"])
    assert payload["user_id"] == str(user.id)
    assert payload["role"] == UserRole.reviewer.value


def test_google_callback_creates_employee_in_default_tenant(auth_db, monkeypatch):
    monkeypatch.setattr(auth_routes, "exchange_google_code_for_id_token", lambda *_: "id-token")
    monkeypatch.setattr(
        auth_routes,
        "verify_google_id_token",
        lambda _: SimpleNamespace(email="google-user@example.com"),
    )

    response = client.post(
        "/api/v1/auth/google/callback",
        json={
            "code": "auth-code",
            "redirect_uri": "http://localhost:3000/api/auth/google/callback",
        },
    )

    assert response.status_code == 200
    assert len(auth_db.users) == 1

    user = auth_db.users[0]
    assert user.email == "google-user@example.com"
    assert user.role == UserRole.employee.value
    assert user.tenant_id == TENANT_ID

    payload = verify_token(response.json()["access_token"])
    assert payload["user_id"] == str(user.id)
    assert payload["role"] == UserRole.employee.value


def test_login_returns_401_for_wrong_password(auth_db):
    user = _employee()
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
    refresh_token = issue_refresh_token(auth_db, user, UserRole.reviewer)

    response = client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})

    assert response.status_code == 200
    body = response.json()
    assert body["expires_in"] == ACCESS_TOKEN_EXPIRE_SECONDS
    assert body["access_token"]

    payload = verify_token(body["access_token"])
    assert payload["user_id"] == str(user.id)
    assert payload["role"] == "REVIEWER"


def test_refresh_returns_401_for_access_token(auth_db):
    user = _employee()
    auth_db.users.append(user)
    access_token = generate_token(user.id, UserRole.employee, user.tenant_id)

    response = client.post("/api/v1/auth/refresh", json={"refresh_token": access_token})

    assert response.status_code == 401


def test_refresh_returns_401_for_revoked_token(auth_db):
    user = _employee()
    auth_db.users.append(user)
    refresh_token = issue_refresh_token(auth_db, user, UserRole.employee)

    logout = client.post("/api/v1/auth/logout", json={"refresh_token": refresh_token})
    assert logout.status_code == 200

    response = client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})
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
            "jti": str(uuid4()),
            "exp": expire,
        },
        get_secret_key(),
        algorithm=ALGORITHM,
    )

    response = client.post("/api/v1/auth/refresh", json={"refresh_token": token})

    assert response.status_code == 401


def test_generate_refresh_token_has_refresh_type_and_jti():
    user_id = UUID("11111111-1111-1111-1111-111111111111")
    issued = generate_refresh_token(user_id, UserRole.employee, TENANT_ID)
    payload = jwt.decode(issued.token, get_secret_key(), algorithms=[ALGORITHM])

    assert payload["type"] == TOKEN_TYPE_REFRESH
    assert payload["user_id"] == str(user_id)
    assert payload["jti"] == str(issued.jti)


def test_verify_token_rejects_refresh_token():
    user_id = UUID("11111111-1111-1111-1111-111111111111")
    issued = generate_refresh_token(user_id, UserRole.employee, TENANT_ID)

    with pytest.raises(InvalidTokenError):
        verify_token(issued.token)


def test_access_token_has_access_type():
    user_id = UUID("11111111-1111-1111-1111-111111111111")
    token = generate_token(user_id, UserRole.employee, TENANT_ID)
    payload = jwt.decode(token, get_secret_key(), algorithms=[ALGORITHM])

    assert payload["type"] == TOKEN_TYPE_ACCESS


def test_refresh_token_expires_in_seven_days():
    user_id = UUID("11111111-1111-1111-1111-111111111111")
    before = datetime.now(UTC)
    issued = generate_refresh_token(user_id, UserRole.employee, TENANT_ID)
    payload = jwt.decode(issued.token, get_secret_key(), algorithms=[ALGORITHM])
    exp = datetime.fromtimestamp(payload["exp"], UTC)

    expected_min = before + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS) - timedelta(minutes=1)
    expected_max = before + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS) + timedelta(minutes=1)
    assert expected_min <= exp <= expected_max


def test_auth_rate_limit_returns_429(monkeypatch, auth_db):
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
    user = _employee()
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


def test_logout_revokes_refresh_token(auth_db):
    user = _employee()
    auth_db.users.append(user)
    refresh_token = issue_refresh_token(auth_db, user, UserRole.employee)

    response = client.post("/api/v1/auth/logout", json={"refresh_token": refresh_token})
    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert auth_db.refresh_tokens[0].revoked_at is not None


def test_forgot_password_always_returns_200(auth_db):
    user = _employee()
    auth_db.users.append(user)

    known = client.post(
        "/api/v1/auth/forgot-password",
        json={"email": "employee@example.com"},
    )
    unknown = client.post(
        "/api/v1/auth/forgot-password",
        json={"email": "missing@example.com"},
    )

    assert known.status_code == 200
    assert unknown.status_code == 200
    assert known.json()["detail"] == unknown.json()["detail"]
    assert len(get_mock_email_outbox()) == 1
    assert "reset-password?token=" in get_mock_email_outbox()[0].text_body
    assert len(auth_db.password_reset_tokens) == 1


def test_reset_password_updates_password_and_revokes_refresh(auth_db):
    user = _employee(password="old-password")
    auth_db.users.append(user)
    refresh_token = issue_refresh_token(auth_db, user, UserRole.employee)

    client.post("/api/v1/auth/forgot-password", json={"email": user.email})
    raw_token = None
    for message in get_mock_email_outbox():
        marker = "reset-password?token="
        if marker in message.text_body:
            raw_token = message.text_body.split(marker, 1)[1].split()[0]
    assert raw_token

    response = client.post(
        "/api/v1/auth/reset-password",
        json={"token": raw_token, "new_password": "new-password"},
    )
    assert response.status_code == 200
    assert verify_password("new-password", user.hashed_password)
    assert auth_db.password_reset_tokens[0].used_at is not None
    assert auth_db.refresh_tokens[0].revoked_at is not None

    replay = client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})
    assert replay.status_code == 401


def test_reset_password_rejects_reused_token(auth_db):
    user = _employee()
    auth_db.users.append(user)
    client.post("/api/v1/auth/forgot-password", json={"email": user.email})
    raw_token = get_mock_email_outbox()[0].text_body.split("token=", 1)[1].split()[0]

    first = client.post(
        "/api/v1/auth/reset-password",
        json={"token": raw_token, "new_password": "new-password"},
    )
    second = client.post(
        "/api/v1/auth/reset-password",
        json={"token": raw_token, "new_password": "another-password"},
    )

    assert first.status_code == 200
    assert second.status_code == 400


def test_reset_password_rejects_expired_token(auth_db):
    user = _employee()
    auth_db.users.append(user)
    raw_token = "expired-reset-token"
    auth_db.password_reset_tokens.append(
        PasswordResetToken(
            id=uuid4(),
            user_id=user.id,
            token_hash=hash_reset_token(raw_token),
            expires_at=datetime.now(UTC) - timedelta(minutes=1),
            used_at=None,
        )
    )

    response = client.post(
        "/api/v1/auth/reset-password",
        json={"token": raw_token, "new_password": "new-password"},
    )
    assert response.status_code == 400


def test_extension_handoff_mint_requires_auth():
    response = client.post("/api/v1/auth/extension-handoff")

    assert response.status_code == 401


def test_extension_handoff_mint_returns_code(auth_db):
    from app.auth.handoff_store import clear_handoff_store

    clear_handoff_store()
    user = _employee()
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
    user = _employee()
    auth_db.users.append(user)
    code = create_handoff_code(user.id)

    response = client.post("/api/v1/auth/extension-handoff/redeem", json={"code": code})

    assert response.status_code == 200
    body = response.json()
    assert body["access_token"]
    assert body["refresh_token"]
    assert body["expires_in"] == ACCESS_TOKEN_EXPIRE_SECONDS
    assert len(auth_db.refresh_tokens) == 1


def test_extension_handoff_redeem_rejects_reused_code(auth_db):
    from app.auth.handoff_store import clear_handoff_store, create_handoff_code

    clear_handoff_store()
    user = _employee()
    auth_db.users.append(user)
    code = create_handoff_code(user.id)

    first = client.post("/api/v1/auth/extension-handoff/redeem", json={"code": code})
    second = client.post("/api/v1/auth/extension-handoff/redeem", json={"code": code})

    assert first.status_code == 200
    assert second.status_code == 401


def test_extension_handoff_redeem_rejects_expired_code(auth_db):
    from app.auth.handoff_store import HandoffEntry, _store, clear_handoff_store

    clear_handoff_store()
    user = _employee()
    auth_db.users.append(user)
    code = "expired-code"
    _store[code] = HandoffEntry(
        user_id=user.id,
        expires_at=datetime.now(UTC) - timedelta(seconds=1),
    )

    response = client.post("/api/v1/auth/extension-handoff/redeem", json={"code": code})

    assert response.status_code == 401


def test_password_reset_email_has_html_and_text_bodies(auth_db):
    message = build_password_reset_email(to="employee@example.com", raw_token="raw-token")

    assert message.subject == "Reset your WorkTrace password"
    assert "http://localhost:3000/reset-password?token=raw-token" in message.text_body
    assert message.html_body is not None
    assert "WorkTrace" in message.html_body
    assert "Reset password" in message.html_body
    assert "expires in 30 minutes" in message.html_body


def test_mock_email_outbox_exposes_reset_link_for_local_hand_testing(auth_db):
    user = _employee()
    auth_db.users.append(user)

    client.post("/api/v1/auth/forgot-password", json={"email": user.email})
    response = client.get("/api/v1/auth/dev/mock-email-outbox")

    assert response.status_code == 200
    body = response.json()
    assert body["messages"][0]["to"] == user.email
    assert body["messages"][0]["reset_url"].startswith(
        "http://localhost:3000/reset-password?token="
    )
    assert body["messages"][0]["html_body"]


def test_mock_email_outbox_is_disabled_outside_mock(auth_db, monkeypatch):
    monkeypatch.setenv("EMAIL_PROVIDER", "ses")

    response = client.get("/api/v1/auth/dev/mock-email-outbox")

    assert response.status_code == 404


def test_forgot_password_logs_send_failure_without_changing_response(auth_db, monkeypatch, caplog):
    class FailingSender:
        def send(self, **_kwargs):
            raise RuntimeError("SES rejected sender")

    user = _employee()
    auth_db.users.append(user)
    monkeypatch.setattr(auth_routes, "get_email_sender", lambda: FailingSender())

    response = client.post("/api/v1/auth/forgot-password", json={"email": user.email})

    assert response.status_code == 200
    assert response.json()["detail"] == (
        "If an account exists for that email, a reset link has been sent."
    )
    assert "Password reset email send failed" in caplog.text
    assert len(auth_db.password_reset_tokens) == 1
