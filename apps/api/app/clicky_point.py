"""Clicky-style screen pointing (ported from farzaa/clicky CompanionManager.swift).

Source logic (MIT): https://github.com/farzaa/clicky
- Prompt asks the model to append [POINT:x,y:label] in screenshot pixel space
  (origin top-left).
- Parser strips the tag and returns coordinates for the overlay spotlight.

We do not modify the Clicky repo; this is a Python port used by WorkTrace
walkthrough locate-element.
"""

from __future__ import annotations

import base64
import logging
import os
import re
from dataclasses import dataclass

from app.openai_client import create_openai_compatible_client
from app.vision_grid import PixelRect, open_image_size, scale_rect_to_viewport
from app.vision_locate_service import (
    DEFAULT_VISION_MODEL,
    VisionLocateError,
    VisionLocateResult,
)

logger = logging.getLogger(__name__)

# Port of Clicky regex:
# [POINT:none] or [POINT:123,456:label] or [POINT:123,456:label:screen2]
_POINT_TAG_RE = re.compile(
    r"\[POINT:(?:none|(\d+)\s*,\s*(\d+)(?::([^\]:\s][^\]:]*?))?(?::screen(\d+))?)\]\s*$",
    re.IGNORECASE,
)

# Compact hole around the POINT. Larger boxes upscale badly when the capture
# is mapped from ~1280px back to DIP (looks like a bottom-right drift).
_DEFAULT_POINT_WIDTH = 72.0
_DEFAULT_POINT_HEIGHT = 32.0


@dataclass(frozen=True)
class PointingParseResult:
    spoken_text: str
    x: float | None
    y: float | None
    element_label: str | None
    screen_number: int | None


def parse_pointing_coordinates(response_text: str) -> PointingParseResult:
    """Python port of CompanionManager.parsePointingCoordinates."""
    text = response_text or ""
    match = _POINT_TAG_RE.search(text)
    if match is None:
        return PointingParseResult(
            spoken_text=text,
            x=None,
            y=None,
            element_label=None,
            screen_number=None,
        )

    spoken = text[: match.start()].rstrip()
    if match.group(1) is None or match.group(2) is None:
        return PointingParseResult(
            spoken_text=spoken,
            x=None,
            y=None,
            element_label="none",
            screen_number=None,
        )

    label = match.group(3)
    screen_raw = match.group(4)
    return PointingParseResult(
        spoken_text=spoken,
        x=float(match.group(1)),
        y=float(match.group(2)),
        element_label=label.strip() if label else None,
        screen_number=int(screen_raw) if screen_raw else None,
    )


def _clicky_system_prompt(image_width: int, image_height: int) -> str:
    """Adapted from Clicky companionVoiceResponseSystemPrompt element-pointing rules."""
    return f"""you are locating a UI control on a screenshot for a step-by-step walkthrough coach.

the screenshot image dimensions are {image_width}x{image_height} pixels.
coordinate space: origin (0,0) is the TOP-LEFT of the image. x increases rightward, y increases downward.
use those pixel dimensions as the coordinate space.

your job:
- find the interactive control the user should activate for the given step
- prefer buttons, links, tabs, menu items, and text fields over decorative text or large headings
- if the same text appears twice, choose the smaller interactive control
- if the step asks for a Windows taskbar / dock app icon, point ONLY at that icon on the BOTTOM taskbar strip — never at a left sidebar, page heading, or window chrome
- if the step is about clicking or typing INSIDE an already-open app (navigate, continue, create, chat, submit), point at that in-window control — NEVER at the taskbar

response format:
- write one short coaching sentence (what to click / where to look)
- then append a coordinate tag at the VERY END
- format: [POINT:x,y:label] where x,y are integer pixel coordinates and label is a short 1-3 word description
- if you truly cannot find the target, append [POINT:none]

examples:
- click the create project button: "click Create project in the modal footer. [POINT:1100,820:create project]"
- focus Claude via taskbar: "click the Claude icon on the bottom taskbar. [POINT:920,1040:claude taskbar]"
- cannot find it: "i cannot see that control on this screenshot. [POINT:none]"

reply with the sentence and the tag only. no markdown fences.
"""


def _resolve_vision_model() -> str:
    return (
        os.getenv("WALKTHROUGH_VISION_MODEL")
        or os.getenv("OPENAI_VISION_MODEL")
        or DEFAULT_VISION_MODEL
    )


def _point_to_rect(
    x: float,
    y: float,
    *,
    image_width: int,
    image_height: int,
    box_width: float = _DEFAULT_POINT_WIDTH,
    box_height: float = _DEFAULT_POINT_HEIGHT,
) -> tuple[float, float, float, float]:
    half_w = box_width / 2.0
    half_h = box_height / 2.0
    left = max(0.0, min(x - half_w, float(image_width) - box_width))
    top = max(0.0, min(y - half_h, float(image_height) - box_height))
    width = min(box_width, float(image_width) - left)
    height = min(box_height, float(image_height) - top)
    if width <= 0 or height <= 0:
        raise VisionLocateError("POINT maps outside the image")
    return left, top, width, height


def locate_element_clicky_point(
    image_bytes: bytes,
    *,
    description: str,
    instruction: str | None,
    viewport_width: int,
    viewport_height: int,
) -> VisionLocateResult:
    """Locate via Clicky [POINT:x,y:label] protocol (vision, not grid)."""
    description = (description or "").strip()
    if not description:
        raise VisionLocateError("description is required")
    if len(description) > 800:
        raise VisionLocateError("description exceeds 800 characters")

    image_width, image_height = open_image_size(image_bytes)
    client = create_openai_compatible_client()
    model = _resolve_vision_model()
    data_url = "data:image/png;base64," + base64.b64encode(image_bytes).decode("ascii")

    user_bits = [f"Locate this control: {description}"]
    if instruction and instruction.strip():
        user_bits.append(f"Step instruction: {instruction.strip()[:2000]}")
    user_bits.append(
        f"Screenshot size: {image_width}x{image_height} pixels. "
        "Append [POINT:x,y:label] or [POINT:none]."
    )

    response = client.chat.completions.create(
        model=model,
        max_tokens=180,
        temperature=0,
        messages=[
            {"role": "system", "content": _clicky_system_prompt(image_width, image_height)},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "\n".join(user_bits)},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            },
        ],
    )

    text = (response.choices[0].message.content or "").strip()
    parsed = parse_pointing_coordinates(text)
    if parsed.x is None or parsed.y is None:
        raise VisionLocateError(f"model returned no POINT coordinate: {text!r}")

    # Clamp into image space (Clicky does the same before scaling).
    px = max(0.0, min(float(parsed.x), float(image_width)))
    py = max(0.0, min(float(parsed.y), float(image_height)))
    ix, iy, iw, ih = _point_to_rect(px, py, image_width=image_width, image_height=image_height)
    image_rect = PixelRect(x=ix, y=iy, width=iw, height=ih)
    viewport_rect = scale_rect_to_viewport(
        image_rect,
        image_width=image_width,
        image_height=image_height,
        viewport_width=viewport_width,
        viewport_height=viewport_height,
    )

    logger.info(
        "clicky POINT locate label=%r at image=(%.0f,%.0f) -> viewport=(%.1f,%.1f %.1fx%.1f)",
        parsed.element_label,
        px,
        py,
        viewport_rect.x,
        viewport_rect.y,
        viewport_rect.width,
        viewport_rect.height,
    )

    hint = parsed.spoken_text.strip() if parsed.spoken_text else None
    if hint and len(hint) > 280:
        hint = hint[:277].rstrip() + "..."

    return VisionLocateResult(
        x=viewport_rect.x,
        y=viewport_rect.y,
        width=viewport_rect.width,
        height=viewport_rect.height,
        image_width=image_width,
        image_height=image_height,
        viewport_width=viewport_width,
        viewport_height=viewport_height,
        coarse_cell=parsed.element_label or "point",
        fine_cell=f"{int(px)},{int(py)}",
        method="clicky_point",
        coaching_hint=hint or None,
    )
