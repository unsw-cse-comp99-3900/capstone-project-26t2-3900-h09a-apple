from __future__ import annotations

import base64
import io
from types import SimpleNamespace

import pytest
from PIL import Image

from app.vision_grid import COARSE_COLS, COARSE_ROWS, FINE_COLS, FINE_ROWS, GridCell
from app.vision_locate_service import (
    VisionLocateError,
    _ask_cell_via_openai,
    decode_image_payload,
    locate_element_two_stage,
)


def _png_b64(width: int = 240, height: int = 160) -> str:
    image = Image.new("RGB", (width, height), color=(180, 180, 180))
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def test_decode_image_payload_accepts_data_url_and_rejects_huge():
    raw = _png_b64()
    decoded = decode_image_payload(f"data:image/png;base64,{raw}")
    assert len(decoded) > 32

    with pytest.raises(VisionLocateError, match="byte limit"):
        decode_image_payload(base64.b64encode(b"x" * (4 * 1024 * 1024 + 8)).decode("ascii"))


def test_decode_image_payload_rejects_empty_invalid_and_non_image():
    with pytest.raises(VisionLocateError, match="required"):
        decode_image_payload("   ")

    with pytest.raises(VisionLocateError, match="valid base64"):
        decode_image_payload("%%%not-base64%%%")

    with pytest.raises(VisionLocateError, match="too small"):
        decode_image_payload(base64.b64encode(b"tiny").decode("ascii"))

    with pytest.raises(VisionLocateError, match="readable image"):
        decode_image_payload(base64.b64encode(b"x" * 64).decode("ascii"))


def test_locate_element_two_stage_with_stub_picker():
    calls: list[tuple[int, int]] = []

    def pick(image_png: bytes, description: str, cols: int, rows: int) -> GridCell:
        assert description == "Submit button"
        assert len(image_png) > 32
        calls.append((cols, rows))
        if cols == COARSE_COLS:
            return GridCell(col=1, row=1, cols=cols, rows=rows)
        return GridCell(col=2, row=2, cols=cols, rows=rows)

    image_bytes = base64.b64decode(_png_b64(360, 240))
    result = locate_element_two_stage(
        image_bytes,
        description="Submit button",
        viewport_width=180,
        viewport_height=120,
        pick_cell=pick,
    )

    assert calls == [(COARSE_COLS, COARSE_ROWS), (FINE_COLS, FINE_ROWS)]
    assert result.method == "vision_grid_2stage"
    assert result.coarse_cell == "B2"
    assert result.fine_cell == "C3"
    assert result.viewport_width == 180
    assert 0 <= result.x < 180
    assert 0 <= result.y < 120
    assert result.width > 0
    assert result.height > 0


def test_locate_requires_description_and_rejects_too_long():
    image_bytes = base64.b64decode(_png_b64())
    with pytest.raises(VisionLocateError, match="description"):
        locate_element_two_stage(
            image_bytes,
            description="  ",
            viewport_width=100,
            viewport_height=100,
            pick_cell=lambda *_args: GridCell(0, 0, COARSE_COLS, COARSE_ROWS),
        )

    with pytest.raises(VisionLocateError, match="500"):
        locate_element_two_stage(
            image_bytes,
            description="x" * 501,
            viewport_width=100,
            viewport_height=100,
            pick_cell=lambda *_args: GridCell(0, 0, COARSE_COLS, COARSE_ROWS),
        )


def test_ask_cell_via_openai_parses_model_label(monkeypatch):
    class FakeCompletions:
        def create(self, **_kwargs):
            return SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content="The cell is B3"))]
            )

    class FakeClient:
        def __init__(self):
            self.chat = SimpleNamespace(completions=FakeCompletions())

    monkeypatch.setattr(
        "app.vision_locate_service.create_openai_compatible_client",
        lambda: FakeClient(),
    )
    monkeypatch.setenv("WALKTHROUGH_VISION_MODEL", "test-vision-model")

    cell = _ask_cell_via_openai(base64.b64decode(_png_b64()), "Save", COARSE_COLS, COARSE_ROWS)
    assert cell == GridCell(col=1, row=2, cols=COARSE_COLS, rows=COARSE_ROWS)


def test_ask_cell_via_openai_rejects_unparseable_label(monkeypatch):
    class FakeCompletions:
        def create(self, **_kwargs):
            return SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content="nowhere"))]
            )

    class FakeClient:
        def __init__(self):
            self.chat = SimpleNamespace(completions=FakeCompletions())

    monkeypatch.setattr(
        "app.vision_locate_service.create_openai_compatible_client",
        lambda: FakeClient(),
    )

    with pytest.raises(VisionLocateError, match="unparseable"):
        _ask_cell_via_openai(base64.b64decode(_png_b64()), "Save", FINE_COLS, FINE_ROWS)


def test_locate_defaults_to_openai_picker(monkeypatch):
    calls: list[tuple[int, int]] = []

    def fake_ask(image_png: bytes, description: str, cols: int, rows: int) -> GridCell:
        assert description == "OK"
        assert len(image_png) > 32
        calls.append((cols, rows))
        return GridCell(col=0, row=0, cols=cols, rows=rows)

    monkeypatch.setattr("app.vision_locate_service._ask_cell_via_openai", fake_ask)
    result = locate_element_two_stage(
        base64.b64decode(_png_b64()),
        description="OK",
        viewport_width=100,
        viewport_height=80,
    )
    assert calls == [(COARSE_COLS, COARSE_ROWS), (FINE_COLS, FINE_ROWS)]
    assert result.coarse_cell == "A1"
    assert result.fine_cell == "A1"
