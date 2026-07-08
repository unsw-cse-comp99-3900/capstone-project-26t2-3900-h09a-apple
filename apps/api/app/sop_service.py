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
) -> tuple[str | None, str | None, str | None]:
    css_selector: str | None = None
    xpath: str | None = None
    screenshot_url: str | None = None

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

    return css_selector, xpath, screenshot_url


def resolve_step_screenshot_url(
    source_event_ids: list[str],
    db: DBSession,
    session_id: UUID,
    tenant_id: UUID,
) -> str | None:
    _, _, screenshot_url = _resolve_step_metadata(
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
        source_event_ids = step.get("source_event_ids", [])
        css_selector, xpath, screenshot_url = _resolve_step_metadata(
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
                instruction=step["instruction"],
                css_selector=css_selector,
                xpath=xpath,
                screenshot_url=screenshot_url,
            )
        )

    return WalkthroughPayload(steps=steps)
