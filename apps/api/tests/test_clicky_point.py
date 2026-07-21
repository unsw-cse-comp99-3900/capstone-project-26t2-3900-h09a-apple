"""Unit tests for Clicky POINT parser (ported from farzaa/clicky)."""

from __future__ import annotations

import io

import pytest
from PIL import Image

from app.clicky_point import (
    locate_element_clicky_point,
    parse_pointing_coordinates,
)
from app.vision_locate_service import VisionLocateError


def test_parse_point_with_label():
    parsed = parse_pointing_coordinates(
        "click Create project in the modal footer. [POINT:1100,820:create project]"
    )
    assert parsed.spoken_text == "click Create project in the modal footer."
    assert parsed.x == 1100.0
    assert parsed.y == 820.0
    assert parsed.element_label == "create project"
    assert parsed.screen_number is None


def test_parse_point_with_screen():
    parsed = parse_pointing_coordinates(
        "that's on the other monitor. [POINT:400,300:terminal:screen2]"
    )
    assert parsed.x == 400.0
    assert parsed.y == 300.0
    assert parsed.element_label == "terminal"
    assert parsed.screen_number == 2


def test_parse_point_none():
    parsed = parse_pointing_coordinates(
        "i cannot see that control on this screenshot. [POINT:none]"
    )
    assert parsed.spoken_text == "i cannot see that control on this screenshot."
    assert parsed.x is None
    assert parsed.y is None
    assert parsed.element_label == "none"


def test_parse_point_missing_tag():
    parsed = parse_pointing_coordinates("no coordinates here")
    assert parsed.spoken_text == "no coordinates here"
    assert parsed.x is None
    assert parsed.element_label is None


def test_parse_point_requires_tag_at_end():
    parsed = parse_pointing_coordinates("[POINT:10,20:foo] trailing junk")
    assert parsed.x is None


def test_locate_element_clicky_point_stub_client(monkeypatch):
    image = Image.new("RGB", (200, 100), color=(10, 20, 30))
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    image_bytes = buf.getvalue()

    class _Msg:
        content = "click the save button near the top. [POINT:150,40:save]"

    class _Choice:
        message = _Msg()

    class _Resp:
        choices = [_Choice()]

    class _Completions:
        def create(self, **_kwargs):
            return _Resp()

    class _Chat:
        completions = _Completions()

    class _Client:
        chat = _Chat()

    monkeypatch.setattr(
        "app.clicky_point.create_openai_compatible_client",
        lambda: _Client(),
    )

    result = locate_element_clicky_point(
        image_bytes,
        description="Save",
        instruction="Click Save",
        viewport_width=200,
        viewport_height=100,
    )
    assert result.method == "clicky_point"
    assert result.fine_cell == "150,40"
    assert result.coarse_cell == "save"
    assert result.coaching_hint == "click the save button near the top."
    assert result.width > 0
    assert result.height > 0
    # Point centered near (150,40) with default 72x32 box.
    assert 80 <= result.x <= 150
    assert 0 <= result.y <= 40


def test_locate_element_clicky_point_none_raises(monkeypatch):
    image = Image.new("RGB", (80, 60), color=(0, 0, 0))
    buf = io.BytesIO()
    image.save(buf, format="PNG")

    class _Msg:
        content = "cannot find it. [POINT:none]"

    class _Choice:
        message = _Msg()

    class _Resp:
        choices = [_Choice()]

    class _Completions:
        def create(self, **_kwargs):
            return _Resp()

    class _Chat:
        completions = _Completions()

    class _Client:
        chat = _Chat()

    monkeypatch.setattr(
        "app.clicky_point.create_openai_compatible_client",
        lambda: _Client(),
    )

    with pytest.raises(VisionLocateError, match="no POINT"):
        locate_element_clicky_point(
            buf.getvalue(),
            description="Missing",
            instruction=None,
            viewport_width=80,
            viewport_height=60,
        )
