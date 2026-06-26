from sqlalchemy.orm import Session as DBSession

from app import models
from app.storage import get_storage


def resolve_step_screenshot_url(
    source_event_ids: list[str],
    db: DBSession,
) -> str | None:
    if not source_event_ids:
        return None
    event_ids = [int(event_id) for event_id in source_event_ids]

    events = (
        db.query(models.Event)
        .filter(models.Event.id.in_(event_ids))
        .order_by(models.Event.seq)
        .all()
    )

    for event in events:
        if event.screenshot_id is None:
            continue

        screenshot = (
            db.query(models.Screenshot).filter(models.Screenshot.id == event.screenshot_id).first()
        )

        if screenshot is None:
            continue
        storage = get_storage()
        return storage.generate_signed_url(screenshot.object_key)

    return None
