from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient

from app.auth.deps import get_current_user
from app.database import get_db
from app.main import app
from app.models import User, UserRole


class _EmptyDb:
    def query(self, model):
        class _Q:
            def join(self, *args, **kwargs):
                return self

            def filter(self, *args, **kwargs):
                return self

            def all(self):
                return []

            def delete(self, synchronize_session=False):
                return 0

        return _Q()

    def commit(self):
        return None


def test_cluster_endpoint_returns_422_for_insufficient_data():
    tenant_id = uuid4()
    manager = User(
        id=uuid4(),
        email="manager@example.com",
        hashed_password="x",
        role=UserRole.manager.value,
        tenant_id=tenant_id,
    )

    app.dependency_overrides[get_db] = lambda: _EmptyDb()
    app.dependency_overrides[get_current_user] = lambda: manager

    client = TestClient(app)
    try:
        response = client.post("/api/v1/workflows/Refund%20flow/cluster")
        assert response.status_code == 422
        assert "at least 3" in response.json()["detail"].lower()
    finally:
        app.dependency_overrides.clear()


def test_cluster_endpoint_requires_manager_role():
    tenant_id = uuid4()
    employee = User(
        id=uuid4(),
        email="employee@example.com",
        hashed_password="x",
        role=UserRole.employee.value,
        tenant_id=tenant_id,
    )

    app.dependency_overrides[get_db] = lambda: _EmptyDb()
    app.dependency_overrides[get_current_user] = lambda: employee

    client = TestClient(app)
    try:
        response = client.post("/api/v1/workflows/Refund/cluster")
        assert response.status_code == 403
    finally:
        app.dependency_overrides.clear()
