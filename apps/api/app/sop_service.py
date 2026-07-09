from __future__ import annotations

from uuid import UUID

from sqlalchemy.orm import Session as DBSession

from app import models
from app.sop_schema import WalkthroughPayload, WalkthroughStep
from app.storage import get_storage

SIGNED_URL_EXPIRY_SECONDS = 60 * 60 * 24


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

        if css_selector and xpath and screenshot_url:
            break
        
        if screenshot_highlight is None:
            attrs = getattr(event, "attrs", None)
            if isinstance(attrs, dict):
                target_rect = attrs.get("target_rect")
                if isinstance(target_rect, dict):
                    screenshot_highlight = target_rect
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
            )
        )

    return WalkthroughPayload(steps=steps)

def _extract_screenshot_highlight(attrs: dict | None) -> dict | None:
    if not isinstance(attrs, dict):
        return None

    target_rect = attrs.get("target_rect")
    if not isinstance(target_rect, dict):
        return None

    required_keys = (
        "x",
        "y",
        "width",
        "height",
        "viewport_width",
        "viewport_height",
    )

    if not all(key in target_rect for key in required_keys):
        return None

    return {
        key: target_rect[key]
        for key in required_keys
    }

def resolve_step_screenshot_highlight(
    source_event_ids,
    db,
    session_id,
):
    try:
        events = (
            db.query(models.Event)
            .filter(
                models.Event.session_id == session_id,
                models.Event.id.in_(source_event_ids),
            )
            .order_by(models.Event.seq.asc())
            .all()
        )
    except Exception:
        return None

    for event in events:
        attrs = getattr(event, "attrs", None)
        if not isinstance(attrs, dict):
            continue

        target_rect = attrs.get("target_rect")
        if isinstance(target_rect, dict):
            return target_rect

    return None