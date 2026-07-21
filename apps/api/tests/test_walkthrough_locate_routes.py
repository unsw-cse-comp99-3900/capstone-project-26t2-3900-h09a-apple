from __future__ import annotations

import base64
import io
from uuid import uuid4

from fastapi.testclient import TestClient
from PIL import Image

from app.auth.deps import get_current_user
from app.main import app
from app.models import User, UserRole
from app.vision_locate_service import VisionLocateError, VisionLocateResult

client = TestClient(app)


def _png_b64() -> str:
    image = Image.new("RGB", (120, 80), color=(200, 200, 200))
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _user() -> User:
    return User(
        id=uuid4(),
        email="employee@example.com",
        hashed_password="x",
        role=UserRole.employee.value,
        tenant_id=uuid4(),
    )


def test_locate_element_requires_auth():
    response = client.post(
        "/api/v1/walkthroughs/locate-element",
        json={
            "image_base64": _png_b64(),
            "description": "Save",
            "viewport_width": 100,
            "viewport_height": 80,
        },
    )
    assert response.status_code == 401


def test_locate_element_returns_viewport_bounds(monkeypatch):
    app.dependency_overrides[get_current_user] = lambda: _user()

    monkeypatch.setattr(
        "app.walkthrough_routes.locate_element_clicky_point",
        lambda *_args, **_kwargs: VisionLocateResult(
            x=10,
            y=20,
            width=30,
            height=40,
            image_width=120,
            image_height=80,
            viewport_width=100,
            viewport_height=80,
            coarse_cell="save",
            fine_cell="55,40",
            method="clicky_point",
        ),
    )

    try:
        response = client.post(
            "/api/v1/walkthroughs/locate-element",
            json={
                "image_base64": _png_b64(),
                "description": "Save button",
                "viewport_width": 100,
                "viewport_height": 80,
            },
        )
        assert response.status_code == 200
        body = response.json()
        assert body["x"] == 10
        assert body["y"] == 20
        assert body["coarse_cell"] == "save"
        assert body["fine_cell"] == "55,40"
        assert body["method"] == "clicky_point"
        assert "image_base64" not in body
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_locate_element_falls_back_to_grid_when_enabled(monkeypatch):
    app.dependency_overrides[get_current_user] = lambda: _user()
    monkeypatch.setenv("WALKTHROUGH_VISION_GRID_FALLBACK", "1")

    monkeypatch.setattr(
        "app.walkthrough_routes.locate_element_clicky_point",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            VisionLocateError("model returned no POINT coordinate")
        ),
    )
    monkeypatch.setattr(
        "app.walkthrough_routes.locate_element_two_stage",
        lambda *_args, **_kwargs: VisionLocateResult(
            x=10,
            y=20,
            width=30,
            height=40,
            image_width=120,
            image_height=80,
            viewport_width=100,
            viewport_height=80,
            coarse_cell="B2",
            fine_cell="C3",
        ),
    )

    try:
        response = client.post(
            "/api/v1/walkthroughs/locate-element",
            json={
                "image_base64": _png_b64(),
                "description": "Save button",
                "viewport_width": 100,
                "viewport_height": 80,
            },
        )
        assert response.status_code == 200
        assert response.json()["method"] == "vision_grid_2stage"
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_locate_element_skips_grid_fallback_by_default(monkeypatch):
    app.dependency_overrides[get_current_user] = lambda: _user()
    monkeypatch.delenv("WALKTHROUGH_VISION_GRID_FALLBACK", raising=False)

    monkeypatch.setattr(
        "app.walkthrough_routes.locate_element_clicky_point",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            VisionLocateError("model returned no POINT coordinate")
        ),
    )
    called = {"grid": False}

    def _grid(*_args, **_kwargs):
        called["grid"] = True
        raise AssertionError("grid fallback should be off")

    monkeypatch.setattr("app.walkthrough_routes.locate_element_two_stage", _grid)

    try:
        response = client.post(
            "/api/v1/walkthroughs/locate-element",
            json={
                "image_base64": _png_b64(),
                "description": "Save button",
                "viewport_width": 100,
                "viewport_height": 80,
            },
        )
        assert response.status_code == 422
        assert called["grid"] is False
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_locate_element_maps_vision_error_to_422(monkeypatch):
    app.dependency_overrides[get_current_user] = lambda: _user()
    monkeypatch.setattr(
        "app.walkthrough_routes.locate_element_clicky_point",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(VisionLocateError("bad image")),
    )
    monkeypatch.setattr(
        "app.walkthrough_routes.locate_element_two_stage",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(VisionLocateError("bad image")),
    )
    try:
        response = client.post(
            "/api/v1/walkthroughs/locate-element",
            json={
                "image_base64": _png_b64(),
                "description": "Save",
                "instruction": "Click save",
                "viewport_width": 100,
                "viewport_height": 80,
            },
        )
        assert response.status_code == 422
        assert "bad image" in response.json()["detail"]
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_locate_element_maps_missing_key_to_503(monkeypatch):
    app.dependency_overrides[get_current_user] = lambda: _user()
    monkeypatch.setattr(
        "app.walkthrough_routes.locate_element_clicky_point",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            RuntimeError("OPENAI_API_KEY or OPENROUTER_API_KEY is not configured")
        ),
    )
    try:
        response = client.post(
            "/api/v1/walkthroughs/locate-element",
            json={
                "image_base64": _png_b64(),
                "description": "Save",
                "viewport_width": 100,
                "viewport_height": 80,
            },
        )
        assert response.status_code == 503
    finally:
        app.dependency_overrides.pop(get_current_user, None)
