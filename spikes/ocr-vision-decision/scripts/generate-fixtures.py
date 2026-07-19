"""Regenerate H09AAPPLE-73 fixture screenshots + ground-truth.json."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1] / "fixtures"


def font(size: int):
    for name in ("segoeui.ttf", "arial.ttf", "calibri.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    cases = []

    img = Image.new("RGB", (280, 200), (245, 246, 248))
    d = ImageDraw.Draw(img)
    d.rectangle((40, 40, 240, 160), fill=(255, 255, 255), outline=(200, 200, 205), width=2)
    d.rectangle((120, 70, 160, 78), fill=(55, 65, 80))
    d.rectangle((128, 85, 152, 140), fill=(55, 65, 80))
    d.line([(134, 95), (134, 130)], fill=(245, 246, 248), width=3)
    d.line([(140, 95), (140, 130)], fill=(245, 246, 248), width=3)
    d.line([(146, 95), (146, 130)], fill=(245, 246, 248), width=3)
    d.ellipse((134, 104, 146, 116), outline=(220, 38, 38), width=2)
    img.save(ROOT / "01-icon-only-delete.png")
    cases.append(
        {
            "id": "01-icon-only-delete",
            "file": "01-icon-only-delete.png",
            "category": "icon_only",
            "description": "Toolbar-style delete control with trash icon and no label text",
            "expected_labels": ["delete", "trash", "remove", "bin"],
            "ocr_expected_contains": [],
            "vision_expected_contains_any": ["delete", "trash", "remove", "bin", "garbage"],
            "notes": "Step-2 vision case; Step-1 OCR should not invent a confident label",
        }
    )

    img = Image.new("RGB", (280, 200), (250, 250, 250))
    d = ImageDraw.Draw(img)
    d.rectangle((30, 70, 250, 130), fill=(255, 255, 255), outline=(180, 180, 185), width=1)
    d.text((48, 92), "Advanced settings", fill=(40, 40, 45), font=font(11))
    d.ellipse((200, 96, 212, 108), outline=(220, 38, 38), width=2)
    img.save(ROOT / "02-small-text-settings.png")
    cases.append(
        {
            "id": "02-small-text-settings",
            "file": "02-small-text-settings.png",
            "category": "small_text",
            "description": "Small UI label Advanced settings",
            "expected_labels": ["advanced settings", "settings"],
            "ocr_expected_contains": ["advanced", "settings"],
            "vision_expected_contains_any": ["advanced", "settings"],
            "notes": "OCR should pick up text; vision should also name the control",
        }
    )

    img = Image.new("RGB", (280, 200), (240, 242, 245))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((70, 70, 210, 120), radius=8, fill=(37, 99, 235), outline=(29, 78, 216))
    d.text((98, 84), "Continue", fill=(255, 255, 255), font=font(22))
    d.ellipse((130, 88, 145, 103), outline=(250, 204, 21), width=2)
    img.save(ROOT / "03-clear-button-continue.png")
    cases.append(
        {
            "id": "03-clear-button-continue",
            "file": "03-clear-button-continue.png",
            "category": "clear_button_text",
            "description": "Primary button labelled Continue",
            "expected_labels": ["continue"],
            "ocr_expected_contains": ["continue"],
            "vision_expected_contains_any": ["continue"],
            "notes": "Baseline easy case for both OCR and vision",
        }
    )

    img = Image.new("RGB", (420, 160), (248, 249, 250))
    d = ImageDraw.Draw(img)
    tools = [(20, "File"), (90, "Edit"), (160, "View"), (240, "Insert"), (330, "Help")]
    d.rectangle((10, 40, 410, 100), fill=(255, 255, 255), outline=(190, 190, 195), width=1)
    for x, label in tools:
        d.rectangle((x, 50, x + 60, 90), fill=(245, 245, 247), outline=(170, 170, 175))
        d.text((x + 10, 60), label, fill=(30, 30, 35), font=font(14))
    d.ellipse((260, 62, 276, 78), outline=(220, 38, 38), width=2)
    img.save(ROOT / "04-cluttered-toolbar-insert.png")
    cases.append(
        {
            "id": "04-cluttered-toolbar-insert",
            "file": "04-cluttered-toolbar-insert.png",
            "category": "cluttered_toolbar",
            "description": "Dense toolbar; red marker on Insert",
            "expected_labels": ["insert"],
            "ocr_expected_contains": ["insert"],
            "vision_expected_contains_any": ["insert"],
            "notes": "Must identify Insert near the red marker, not just any toolbar word",
        }
    )

    img = Image.new("RGB", (280, 200), (252, 252, 252))
    d = ImageDraw.Draw(img)
    d.rectangle((90, 45, 190, 155), fill=(255, 255, 255), outline=(200, 200, 205))
    d.ellipse((120, 60, 140, 80), outline=(55, 65, 80), width=3)
    d.ellipse((155, 95, 175, 115), outline=(55, 65, 80), width=3)
    d.ellipse((120, 115, 140, 135), outline=(55, 65, 80), width=3)
    d.line([(140, 70), (155, 105)], fill=(55, 65, 80), width=2)
    d.line([(130, 80), (130, 115)], fill=(55, 65, 80), width=2)
    d.text((118, 140), "Share", fill=(60, 60, 65), font=font(12))
    d.ellipse((130, 95, 145, 110), outline=(220, 38, 38), width=2)
    img.save(ROOT / "05-icon-with-caption-share.png")
    cases.append(
        {
            "id": "05-icon-with-caption-share",
            "file": "05-icon-with-caption-share.png",
            "category": "icon_with_caption",
            "description": "Share icon with small caption",
            "expected_labels": ["share"],
            "ocr_expected_contains": ["share"],
            "vision_expected_contains_any": ["share"],
            "notes": "OCR may get caption; vision should resolve even if OCR misses",
        }
    )

    meta = {
        "purpose": "H09AAPPLE-73 empirical OCR vs vision comparison fixtures",
        "scoring": (
            "Case passes OCR if all ocr_expected_contains tokens appear in normalized OCR text. "
            "Vision passes if any vision_expected_contains_any token appears in normalized model answer. "
            "Icon-only OCR is expected to fail (empty/wrong) - scored separately."
        ),
        "hardware_note": "Record host machine specs in results/run-meta.json",
        "cases": cases,
    }
    (ROOT / "ground-truth.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"Wrote {len(cases)} fixtures to {ROOT}")


if __name__ == "__main__":
    main()
