"""Vision locate orchestration: two-stage grid via OpenAI-compatible vision API."""

from __future__ import annotations

import base64
import logging
import os
import re
from collections.abc import Callable
from dataclasses import dataclass

from app.openai_client import create_openai_compatible_client
from app.vision_grid import (
    COARSE_COLS,
    COARSE_ROWS,
    FINE_COLS,
    FINE_ROWS,
    GridCell,
    PixelRect,
    compose_rects,
    crop_cell_image,
    draw_numbered_grid,
    open_image_size,
    parse_cell_label,
    scale_rect_to_viewport,
)

logger = logging.getLogger(__name__)

DEFAULT_VISION_MODEL = "gpt-4o-mini"
MAX_IMAGE_BYTES = 4 * 1024 * 1024
_DATA_URL_RE = re.compile(r"^data:(image/(?:jpeg|png|webp));base64,(.+)$", re.DOTALL)


class VisionLocateError(Exception):
    """Raised when vision locate cannot produce a usable target."""


@dataclass(frozen=True)
class VisionLocateResult:
    x: float
    y: float
    width: float
    height: float
    image_width: int
    image_height: int
    viewport_width: int
    viewport_height: int
    coarse_cell: str
    fine_cell: str
    method: str = "vision_grid_2stage"


CellPicker = Callable[[bytes, str, int, int], GridCell]


def decode_image_payload(image_base64: str, content_type: str | None = None) -> bytes:
    raw = (image_base64 or "").strip()
    if not raw:
        raise VisionLocateError("image_base64 is required")

    match = _DATA_URL_RE.match(raw)
    if match:
        raw = match.group(2)

    try:
        data = base64.b64decode(raw, validate=True)
    except Exception as exc:  # noqa: BLE001 - normalize client input errors
        raise VisionLocateError("image_base64 is not valid base64") from exc

    if len(data) > MAX_IMAGE_BYTES:
        raise VisionLocateError(f"image exceeds {MAX_IMAGE_BYTES} byte limit")
    if len(data) < 32:
        raise VisionLocateError("image payload is too small")

    # content_type is accepted for clients; PIL validates the actual bytes.
    _ = content_type
    try:
        open_image_size(data)
    except Exception as exc:  # noqa: BLE001
        raise VisionLocateError("image payload is not a readable image") from exc
    return data


def _resolve_vision_model() -> str:
    return (
        os.getenv("WALKTHROUGH_VISION_MODEL")
        or os.getenv("OPENAI_VISION_MODEL")
        or DEFAULT_VISION_MODEL
    )


def _ask_cell_via_openai(
    image_png: bytes,
    description: str,
    cols: int,
    rows: int,
) -> GridCell:
    client = create_openai_compatible_client()
    model = _resolve_vision_model()
    data_url = "data:image/png;base64," + base64.b64encode(image_png).decode("ascii")

    prompt = (
        "You are locating a UI element on a screenshot overlaid with a letter-number grid. "
        f"The grid has columns A-{chr(ord('A') + cols - 1)} and rows 1-{rows}. "
        f'Find the cell that best contains this element: "{description}". '
        "Reply with ONLY the cell label (for example B3). No other words."
    )

    response = client.chat.completions.create(
        model=model,
        max_tokens=16,
        temperature=0,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            }
        ],
    )

    text = (response.choices[0].message.content or "").strip()
    cell = parse_cell_label(text, cols=cols, rows=rows)
    if cell is None:
        raise VisionLocateError(f"model returned unparseable cell label: {text!r}")
    return cell


def locate_element_two_stage(
    image_bytes: bytes,
    *,
    description: str,
    viewport_width: int,
    viewport_height: int,
    pick_cell: CellPicker | None = None,
) -> VisionLocateResult:
    description = (description or "").strip()
    if not description:
        raise VisionLocateError("description is required")
    if len(description) > 500:
        raise VisionLocateError("description exceeds 500 characters")

    picker = pick_cell or _ask_cell_via_openai
    image_width, image_height = open_image_size(image_bytes)

    coarse_image = draw_numbered_grid(
        image_bytes,
        cols=COARSE_COLS,
        rows=COARSE_ROWS,
    )
    coarse = picker(coarse_image, description, COARSE_COLS, COARSE_ROWS)
    logger.info("vision locate coarse cell=%s", coarse.label)

    cropped = crop_cell_image(image_bytes, coarse)
    fine_image = draw_numbered_grid(cropped, cols=FINE_COLS, rows=FINE_ROWS)
    fine = picker(fine_image, description, FINE_COLS, FINE_ROWS)
    logger.info("vision locate fine cell=%s", fine.label)

    image_rect = compose_rects(coarse, fine, image_width, image_height)
    viewport_rect: PixelRect = scale_rect_to_viewport(
        image_rect,
        image_width=image_width,
        image_height=image_height,
        viewport_width=viewport_width,
        viewport_height=viewport_height,
    )

    return VisionLocateResult(
        x=viewport_rect.x,
        y=viewport_rect.y,
        width=viewport_rect.width,
        height=viewport_rect.height,
        image_width=image_width,
        image_height=image_height,
        viewport_width=viewport_width,
        viewport_height=viewport_height,
        coarse_cell=coarse.label,
        fine_cell=fine.label,
    )
