from __future__ import annotations

from math import ceil
from uuid import UUID

from sqlalchemy.orm import Session as DBSession

from app import models
from app.sop_schema import WalkthroughPayload, WalkthroughStep
from app.storage import get_storage

SIGNED_URL_EXPIRY_SECONDS = 60 * 60 * 24
DEFAULT_STEP_ESTIMATE_SECONDS = 5
MAX_EVENT_GAP_SECONDS = 30
MAX_STEP_ESTIMATE_SECONDS = 60


class WalkthroughDataError(Exception):
    """Published SOP data cannot be converted into a walkthrough payload."""


def _parse_event_ids(source_event_ids: list[str]) -> list[int]:
    parsed: list[int] = []
    for event_id in source_event_ids:
        try:
            parsed.append(int(event_id))
        except (TypeError, ValueError):
            continue
    return parsed


def _load_ordered_events(
    source_event_ids: list[str],
    session_id: UUID,
    tenant_id: UUID,
    db: DBSession,
) -> list[models.Event]:
    event_ids = _parse_event_ids(source_event_ids)
    if not event_ids:
        return []

    return (
        db.query(models.Event)
        .join(models.Session, models.Event.session_id == models.Session.id)
        .filter(
            models.Event.id.in_(event_ids),
            models.Event.session_id == session_id,
            models.Session.tenant_id == tenant_id,
        )
        .order_by(models.Event.seq)
        .all()
    )


def _resolve_screenshot_url(
    screenshot_id: UUID,
    session_id: UUID,
    tenant_id: UUID,
    db: DBSession,
) -> str | None:
    screenshot = (
        db.query(models.Screenshot)
        .join(models.Session, models.Screenshot.session_id == models.Session.id)
        .filter(
            models.Screenshot.id == screenshot_id,
            models.Screenshot.session_id == session_id,
            models.Session.tenant_id == tenant_id,
        )
        .first()
    )

    if screenshot is None:
        return None

    storage = get_storage()
    return storage.generate_signed_url(
        screenshot.object_key,
        expires=SIGNED_URL_EXPIRY_SECONDS,
    )


def _xpath_from_attrs(attrs: object) -> str | None:
    if not isinstance(attrs, dict):
        return None

    xpath = attrs.get("xpath")
    if xpath is None:
        return None

    xpath_text = str(xpath).strip()
    return xpath_text or None


def _resolve_step_metadata(
    source_event_ids: list[str],
    session_id: UUID,
    tenant_id: UUID,
    db: DBSession,
) -> tuple[str | None, str | None, str | None, dict | None]:
    css_selector = None
    xpath = None
    screenshot_url = None
    screenshot_highlight = None

    for event in _load_ordered_events(source_event_ids, session_id, tenant_id, db):
        if css_selector is None:
            selector = getattr(event, "target_selector", None)
            if selector:
                css_selector = selector
        if xpath is None:
            xpath = _xpath_from_attrs(getattr(event, "attrs", None))

        if screenshot_url is None:
            screenshot_id = getattr(event, "screenshot_id", None)
            if screenshot_id is not None:
                screenshot_url = _resolve_screenshot_url(
                    screenshot_id,
                    session_id,
                    tenant_id,
                    db,
                )

        if screenshot_highlight is None:
            screenshot_highlight = _extract_screenshot_highlight(getattr(event, "attrs", None))

        if css_selector and xpath and screenshot_url and screenshot_highlight:
            break
    return css_selector, xpath, screenshot_url, screenshot_highlight


def resolve_step_screenshot_url(
    source_event_ids: list[str],
    db: DBSession,
    session_id: UUID,
    tenant_id: UUID,
) -> str | None:
    _, _, screenshot_url, _ = _resolve_step_metadata(
        source_event_ids,
        session_id,
        tenant_id,
        db,
    )
    return screenshot_url


def build_walkthrough_payload(sop: models.Sop, db: DBSession) -> WalkthroughPayload:
    if not sop.steps:
        raise WalkthroughDataError("SOP has no walkthrough steps")

    steps: list[WalkthroughStep] = []

    for step in sop.steps:
        if "order" not in step:
            raise WalkthroughDataError("Step is missing order")
        if "instruction" not in step:
            raise WalkthroughDataError(f"Step {step['order']} is missing instruction")

        instruction = step["instruction"]
        if not isinstance(instruction, str) or not instruction.strip():
            raise WalkthroughDataError(f"Step {step['order']} has empty instruction")

        source_event_ids = step.get("source_event_ids", [])
        css_selector, xpath, screenshot_url, screenshot_highlight = _resolve_step_metadata(
            source_event_ids,
            sop.session_id,
            sop.tenant_id,
            db,
        )

        raw_time_estimate = step.get("time_estimate")
        try:
            time_estimate = int(raw_time_estimate) if raw_time_estimate is not None else None
        except (TypeError, ValueError):
            time_estimate = None

        if time_estimate is None or time_estimate > MAX_STEP_ESTIMATE_SECONDS:
            time_estimate = resolve_step_time_estimate(
                source_event_ids,
                db,
                sop.session_id,
                sop.tenant_id,
            )

        if not css_selector and not xpath:
            raise WalkthroughDataError(
                f"Step {step['order']} is missing css_selector and xpath",
            )

        steps.append(
            WalkthroughStep(
                step_number=step["order"],
                instruction=instruction,
                css_selector=css_selector,
                xpath=xpath,
                screenshot_url=screenshot_url,
                time_estimate=time_estimate,
                screenshot_highlight=screenshot_highlight,
            )
        )

    return WalkthroughPayload(steps=steps)


def _extract_screenshot_highlight(attrs: dict | None) -> dict | None:
    if not isinstance(attrs, dict):
        return None

    target_rect = attrs.get("target_rect")
    if not isinstance(target_rect, dict):
        return None

    try:
        x = float(target_rect["x"])
        y = float(target_rect["y"])
        width = float(target_rect["width"])
        height = float(target_rect["height"])
        viewport_width = float(target_rect["viewport_width"])
        viewport_height = float(target_rect["viewport_height"])
    except (KeyError, TypeError, ValueError):
        return None

    if width <= 0 or height <= 0 or viewport_width <= 0 or viewport_height <= 0:
        return None

    return {
        "x": max(0, x),
        "y": max(0, y),
        "width": width,
        "height": height,
        "viewport_width": viewport_width,
        "viewport_height": viewport_height,
    }


def resolve_step_screenshot_highlight(
    source_event_ids: list[str],
    db: DBSession,
    session_id: UUID,
) -> dict | None:
    event_ids = _parse_event_ids(source_event_ids)
    if not event_ids:
        return None

    try:
        events = (
            db.query(models.Event)
            .filter(
                models.Event.session_id == session_id,
                models.Event.id.in_(event_ids),
            )
            .order_by(models.Event.seq.asc())
            .all()
        )
    except Exception:
        return None

    for event in events:
        highlight = _extract_screenshot_highlight(getattr(event, "attrs", None))
        if highlight is not None:
            return highlight

    return None


def resolve_step_time_estimate(
    source_event_ids: list[str],
    db: DBSession,
    session_id: UUID,
    tenant_id: UUID,
) -> int | None:
    events = _load_ordered_events(source_event_ids, session_id, tenant_id, db)

    timestamps = sorted(
        int(event.timestamp_ms)
        for event in events
        if getattr(event, "timestamp_ms", None) is not None
    )

    if not timestamps:
        return None

    if len(timestamps) == 1:
        return DEFAULT_STEP_ESTIMATE_SECONDS

    active_ms = 0
    max_gap_ms = MAX_EVENT_GAP_SECONDS * 1000

    for previous, current in zip(timestamps, timestamps[1:], strict=False):
        gap_ms = current - previous
        if 0 <= gap_ms <= max_gap_ms:
            active_ms += gap_ms

    if active_ms <= 0:
        return DEFAULT_STEP_ESTIMATE_SECONDS

    return min(MAX_STEP_ESTIMATE_SECONDS, max(1, ceil(active_ms / 1000)))
