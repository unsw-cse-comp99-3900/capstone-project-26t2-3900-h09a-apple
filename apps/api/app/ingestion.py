from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID, uuid4

from sqlalchemy.orm import Session as DBSession

from app import models
from app.pii import mask_session_payload
from app.session_schema import SessionPayload
from app.storage import ObjectStorage, upload_screenshot


@dataclass(frozen=True)
class IngestedSession:
    session_id: str
    job_id: str
    masked_payload: SessionPayload


def ingest_session(
    payload: SessionPayload,
    db: DBSession,
    tenant_id: UUID,
    storage: ObjectStorage | None = None,
    recorded_by: UUID | None = None,
) -> IngestedSession:
    masked_payload = mask_session_payload(payload)
    session_id = uuid4()
    job_id = uuid4()

    session = models.Session(
        id=session_id,
        client_session_id=masked_payload.client_session_id,
        tenant_id=tenant_id,
        recorded_by=recorded_by,
        workflow_name=masked_payload.workflow_name,
        status=models.SessionStatus.submitted.value,
        started_at=masked_payload.started_at,
        stopped_at=masked_payload.stopped_at,
        event_count=len(masked_payload.events),
    )

    db.add(session)
    db.flush()

    if storage is not None:
        for screenshot in masked_payload.screenshots:
            uploaded = upload_screenshot(storage, session_id, screenshot)
            db.add(
                models.Screenshot(
                    id=screenshot.id,
                    session_id=session_id,
                    object_key=uploaded.object_key,
                    width=screenshot.width,
                    height=screenshot.height,
                    bytes=uploaded.bytes,
                )
            )

        db.flush()

    sorted_events = sorted(masked_payload.events, key=lambda event: event.timestamp_ms)
    session.events = [
        models.Event(
            seq=seq,
            type=event.type.value,
            target_selector=event.target_selector,
            target_label=event.target_label,
            value=event.value,
            url=event.url,
            attrs=event.attrs,
            screenshot_id=event.screenshot_id,
            timestamp_ms=event.timestamp_ms,
        )
        for seq, event in enumerate(sorted_events)
    ]

    job = models.CodificationJob(
        id=job_id,
        session_id=session_id,
        job_type=models.CodificationJobType.generate.value,
        status=models.CodificationJobStatus.pending.value,
    )

    db.add(job)
    db.flush()

    return IngestedSession(
        session_id=str(session_id),
        job_id=str(job_id),
        masked_payload=masked_payload,
    )
