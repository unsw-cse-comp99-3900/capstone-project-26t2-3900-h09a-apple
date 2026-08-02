from uuid import uuid4

from fastapi.testclient import TestClient

from app.auth.deps import get_current_user
from app.auth.jwt import verify_access_or_ws_token
from app.main import app
from app.models import User, UserRole


def _user(role: UserRole) -> User:
    return User(
        id=uuid4(),
        email=f"{role.value.lower()}@example.com",
        hashed_password="x",
        role=role.value,
        tenant_id=uuid4(),
    )


def test_manager_can_mint_friction_websocket_ticket():
    manager = _user(UserRole.manager)
    previous_user = app.dependency_overrides.get(get_current_user)
    app.dependency_overrides[get_current_user] = lambda: manager

    try:
        response = TestClient(app).post("/api/v1/analytics/friction/ws-ticket")
    finally:
        if previous_user is None:
            app.dependency_overrides.pop(get_current_user, None)
        else:
            app.dependency_overrides[get_current_user] = previous_user

    assert response.status_code == 200
    body = response.json()
    assert body["expires_in_seconds"] == 60
    assert body["ws_path"] == "/api/v1/analytics/friction/ws"
    assert verify_access_or_ws_token(body["ticket"]) == {
        "user_id": str(manager.id),
        "role": UserRole.manager.value,
        "tenant_id": str(manager.tenant_id),
    }


def test_employee_cannot_mint_friction_websocket_ticket():
    employee = _user(UserRole.employee)
    previous_user = app.dependency_overrides.get(get_current_user)
    app.dependency_overrides[get_current_user] = lambda: employee

    try:
        response = TestClient(app).post("/api/v1/analytics/friction/ws-ticket")
    finally:
        if previous_user is None:
            app.dependency_overrides.pop(get_current_user, None)
        else:
            app.dependency_overrides[get_current_user] = previous_user

    assert response.status_code == 403


def test_reviewer_cannot_mint_friction_websocket_ticket():
    reviewer = _user(UserRole.reviewer)
    previous_user = app.dependency_overrides.get(get_current_user)
    app.dependency_overrides[get_current_user] = lambda: reviewer

    try:
        response = TestClient(app).post("/api/v1/analytics/friction/ws-ticket")
    finally:
        if previous_user is None:
            app.dependency_overrides.pop(get_current_user, None)
        else:
            app.dependency_overrides[get_current_user] = previous_user

    assert response.status_code == 403
