"""Two-stage grid geometry for vision-based element location (H09AAPPLE-53)."""

from __future__ import annotations

import io
import re
from dataclasses import dataclass

from PIL import Image, ImageDraw, ImageFont

COARSE_COLS = 12
COARSE_ROWS = 8
FINE_COLS = 6
FINE_ROWS = 6

_CELL_RE = re.compile(r"\b([A-L])\s*[-:]?\s*([1-8])\b", re.IGNORECASE)
_FINE_CELL_RE = re.compile(r"\b([A-F])\s*[-:]?\s*([1-6])\b", re.IGNORECASE)


@dataclass(frozen=True)
class GridCell:
    col: int  # 0-based
    row: int  # 0-based
    cols: int
    rows: int

    @property
    def label(self) -> str:
        return f"{chr(ord('A') + self.col)}{self.row + 1}"


@dataclass(frozen=True)
class PixelRect:
    x: float
    y: float
    width: float
    height: float

    def clamp(self, max_width: float, max_height: float) -> PixelRect:
        x = min(max(self.x, 0.0), max(0.0, max_width - 1.0))
        y = min(max(self.y, 0.0), max(0.0, max_height - 1.0))
        width = min(max(self.width, 1.0), max_width - x)
        height = min(max(self.height, 1.0), max_height - y)
        return PixelRect(x=x, y=y, width=width, height=height)

    def scale(self, scale_x: float, scale_y: float) -> PixelRect:
        return PixelRect(
            x=self.x * scale_x,
            y=self.y * scale_y,
            width=self.width * scale_x,
            height=self.height * scale_y,
        )


def col_letter_to_index(letter: str, cols: int) -> int | None:
    if not letter or len(letter) != 1:
        return None
    index = ord(letter.upper()) - ord("A")
    if 0 <= index < cols:
        return index
    return None


def parse_cell_label(text: str, *, cols: int, rows: int) -> GridCell | None:
    """Extract the first plausible grid cell label from model output."""
    if not text:
        return None

    pattern = _FINE_CELL_RE if cols <= 6 else _CELL_RE
    match = pattern.search(text.strip())
    if match is None and cols <= 6:
        match = _CELL_RE.search(text.strip())
    if match is None:
        return None

    col = col_letter_to_index(match.group(1), cols)
    try:
        row = int(match.group(2)) - 1
    except ValueError:
        return None
    if col is None or row < 0 or row >= rows:
        return None
    return GridCell(col=col, row=row, cols=cols, rows=rows)


def cell_rect(cell: GridCell, image_width: int, image_height: int) -> PixelRect:
    cell_w = image_width / cell.cols
    cell_h = image_height / cell.rows
    return PixelRect(
        x=cell.col * cell_w,
        y=cell.row * cell_h,
        width=cell_w,
        height=cell_h,
    ).clamp(float(image_width), float(image_height))


def compose_rects(
    coarse: GridCell,
    fine: GridCell,
    image_width: int,
    image_height: int,
) -> PixelRect:
    """Map fine cell inside a coarse cell back to full-image coordinates."""
    outer = cell_rect(coarse, image_width, image_height)
    inner = cell_rect(fine, int(outer.width), int(outer.height))
    return PixelRect(
        x=outer.x + inner.x,
        y=outer.y + inner.y,
        width=inner.width,
        height=inner.height,
    ).clamp(float(image_width), float(image_height))


def scale_rect_to_viewport(
    rect: PixelRect,
    *,
    image_width: int,
    image_height: int,
    viewport_width: int,
    viewport_height: int,
) -> PixelRect:
    if image_width <= 0 or image_height <= 0:
        raise ValueError("image dimensions must be positive")
    if viewport_width <= 0 or viewport_height <= 0:
        raise ValueError("viewport dimensions must be positive")

    return rect.scale(
        viewport_width / image_width,
        viewport_height / image_height,
    ).clamp(float(viewport_width), float(viewport_height))


def _load_font(size: int) -> ImageFont.ImageFont | ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype("DejaVuSans.ttf", size=size)
    except OSError:
        try:
            return ImageFont.truetype("arial.ttf", size=size)
        except OSError:
            return ImageFont.load_default()


def draw_numbered_grid(
    image_bytes: bytes,
    *,
    cols: int,
    rows: int,
) -> bytes:
    """Overlay a labeled grid on a screenshot; returns PNG bytes."""
    image = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    width, height = image.size
    cell_w = width / cols
    cell_h = height / rows
    font = _load_font(max(10, int(min(cell_w, cell_h) * 0.28)))
    line_color = (79, 107, 237, 180)
    text_fill = (15, 23, 42, 230)
    text_bg = (248, 250, 252, 200)

    for row in range(rows + 1):
        y = int(round(row * cell_h))
        draw.line([(0, y), (width, y)], fill=line_color, width=2)
    for col in range(cols + 1):
        x = int(round(col * cell_w))
        draw.line([(x, 0), (x, height)], fill=line_color, width=2)

    for row in range(rows):
        for col in range(cols):
            label = f"{chr(ord('A') + col)}{row + 1}"
            x0 = col * cell_w + 4
            y0 = row * cell_h + 4
            bbox = draw.textbbox((x0, y0), label, font=font)
            draw.rectangle(
                [bbox[0] - 2, bbox[1] - 1, bbox[2] + 2, bbox[3] + 1],
                fill=text_bg,
            )
            draw.text((x0, y0), label, fill=text_fill, font=font)

    composed = Image.alpha_composite(image, overlay).convert("RGB")
    out = io.BytesIO()
    composed.save(out, format="PNG", optimize=True)
    return out.getvalue()


def crop_cell_image(
    image_bytes: bytes,
    cell: GridCell,
    *,
    pad_ratio: float = 0.05,
) -> bytes:
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    width, height = image.size
    rect = cell_rect(cell, width, height)
    pad_x = rect.width * pad_ratio
    pad_y = rect.height * pad_ratio
    left = max(0, int(rect.x - pad_x))
    top = max(0, int(rect.y - pad_y))
    right = min(width, int(rect.x + rect.width + pad_x))
    bottom = min(height, int(rect.y + rect.height + pad_y))
    cropped = image.crop((left, top, right, bottom))
    out = io.BytesIO()
    cropped.save(out, format="PNG", optimize=True)
    return out.getvalue()


def open_image_size(image_bytes: bytes) -> tuple[int, int]:
    with Image.open(io.BytesIO(image_bytes)) as image:
        return image.size
