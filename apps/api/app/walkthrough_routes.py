from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session as DBSession

from app import models
from app.auth.deps import filter_by_tenant, require_role
from app.database import get_db
from app.models import User, UserRole
from app.walkthrough_schema import (
    WalkthroughCompletionPayload,
    WalkthroughCompletionResponse,
)

router = APIRouter(
    prefix="/api/v1/walkthroughs",
    tags=["walkthrough"],
)


@router.post(
    "/complete",
    response_model=WalkthroughCompletionResponse,
    status_code=status.HTTP_201_CREATED,
)
def complete_walkthrough(
    payload: WalkthroughCompletionPayload,
    current_user: Annotated[User, Depends(require_role(UserRole.employee))],
    db: Annotated[DBSession, Depends(get_db)],
) -> WalkthroughCompletionResponse:
    sop = (
        filter_by_tenant(
            db.query(models.Sop),
            models.Sop,
            current_user.tenant_id,
        )
        .filter(models.Sop.id == payload.sop_id)
        .first()
    )

    if sop is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="SOP not found",
        )

    try:
        completion = models.WalkthroughCompletion(
            tenant_id=current_user.tenant_id,
            sop_id=sop.id,
            employee_id=current_user.id,
            completed_at=payload.completed_at,
            duration_seconds=payload.duration_seconds,
        )
        db.add(completion)
        db.flush()

        for event in payload.friction_events:
            db.add(
                models.WalkthroughFrictionEvent(
                    completion_id=completion.id,
                    step_number=event.step_number,
                    event_type=event.event_type.value,
                    occurred_at=event.occurred_at,
                )
            )

        for timing in payload.step_timings:
            db.add(
                models.WalkthroughStepTiming(
                    completion_id=completion.id,
                    step_number=timing.step_number,
                    duration_ms=timing.duration_ms,
                )
            )

        db.commit()

    except Exception:
        db.rollback()
        raise

    return WalkthroughCompletionResponse(
        completion_id=completion.id,
    )
