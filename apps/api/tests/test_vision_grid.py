from __future__ import annotations

import io

import pytest
from PIL import Image

from app.vision_grid import (
    COARSE_COLS,
    COARSE_ROWS,
    FINE_COLS,
    FINE_ROWS,
    GridCell,
    PixelRect,
    cell_rect,
    col_letter_to_index,
    compose_rects,
    draw_numbered_grid,
    parse_cell_label,
    scale_rect_to_viewport,
)


def _png_bytes(width: int = 240, height: int = 160) -> bytes:
    image = Image.new("RGB", (width, height), color=(220, 220, 220))
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def test_parse_cell_label_accepts_noisy_model_output():
    cell = parse_cell_label("The element is in cell C4.", cols=COARSE_COLS, rows=COARSE_ROWS)
    assert cell == GridCell(col=2, row=3, cols=COARSE_COLS, rows=COARSE_ROWS)


def test_parse_cell_label_rejects_out_of_range_for_fine_grid():
    assert parse_cell_label("L8", cols=FINE_COLS, rows=FINE_ROWS) is None
    assert parse_cell_label("B2", cols=FINE_COLS, rows=FINE_ROWS) == GridCell(
        col=1, row=1, cols=FINE_COLS, rows=FINE_ROWS
    )


def test_compose_and_scale_maps_fine_cell_into_viewport():
    coarse = GridCell(col=0, row=0, cols=COARSE_COLS, rows=COARSE_ROWS)
    fine = GridCell(col=0, row=0, cols=FINE_COLS, rows=FINE_ROWS)
    image_rect = compose_rects(coarse, fine, 1200, 800)
    viewport = scale_rect_to_viewport(
        image_rect,
        image_width=1200,
        image_height=800,
        viewport_width=600,
        viewport_height=400,
    )
    assert viewport.x == 0
    assert viewport.y == 0
    assert viewport.width > 0
    assert viewport.height > 0
    assert viewport.x + viewport.width <= 600
    assert viewport.y + viewport.height <= 400
    # Top-left fine cell sits inside the top-left coarse cell.
    coarse_rect = cell_rect(coarse, 1200, 800)
    assert image_rect.x >= coarse_rect.x
    assert image_rect.y >= coarse_rect.y
    assert image_rect.x + image_rect.width <= coarse_rect.x + coarse_rect.width + 0.01


def test_draw_numbered_grid_returns_png():
    out = draw_numbered_grid(_png_bytes(), cols=COARSE_COLS, rows=COARSE_ROWS)
    image = Image.open(io.BytesIO(out))
    assert image.format == "PNG"
    assert image.size == (240, 160)


def test_col_letter_and_parse_edge_cases():
    assert col_letter_to_index("", COARSE_COLS) is None
    assert col_letter_to_index("AB", COARSE_COLS) is None
    assert col_letter_to_index("Z", COARSE_COLS) is None
    assert parse_cell_label("", cols=COARSE_COLS, rows=COARSE_ROWS) is None
    assert parse_cell_label("no cell here", cols=COARSE_COLS, rows=COARSE_ROWS) is None
    assert parse_cell_label("A0", cols=COARSE_COLS, rows=COARSE_ROWS) is None


def test_scale_rect_rejects_non_positive_dimensions():
    rect = PixelRect(x=0, y=0, width=10, height=10)
    with pytest.raises(ValueError, match="image dimensions"):
        scale_rect_to_viewport(
            rect,
            image_width=0,
            image_height=10,
            viewport_width=100,
            viewport_height=100,
        )
    with pytest.raises(ValueError, match="viewport dimensions"):
        scale_rect_to_viewport(
            rect,
            image_width=10,
            image_height=10,
            viewport_width=0,
            viewport_height=100,
        )
