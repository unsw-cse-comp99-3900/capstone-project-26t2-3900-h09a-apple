from __future__ import annotations

import os
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session as DBSession

from app import models
from app.auth.deps import filter_by_tenant, require_role
from app.clicky_point import locate_element_clicky_point
from app.database import get_db
from app.models import User, UserRole
from app.vision_locate_service import (
    VisionLocateError,
    decode_image_payload,
    locate_element_two_stage,
)
from app.walkthrough_schema import (
    WalkthroughCompletionPayload,
    WalkthroughCompletionResponse,
    WalkthroughLocateRequest,
    WalkthroughLocateResponse,
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


@router.post(
    "/locate-element",
    response_model=WalkthroughLocateResponse,
)
def locate_walkthrough_element(
    payload: WalkthroughLocateRequest,
    current_user: Annotated[User, Depends(require_role(UserRole.employee))],
) -> WalkthroughLocateResponse:
    """Locate a UI control from a screenshot.

    Primary path ports Clicky [POINT:x,y:label] (one vision call).
    Two-stage grid fallback is OFF by default — it doubles latency per step.
    Set WALKTHROUGH_VISION_GRID_FALLBACK=1 to re-enable.
    """
    _ = current_user  # auth + tenant gate only; no cross-tenant image store

    description = payload.description.strip()
    instruction = payload.instruction.strip() if payload.instruction else None
    grid_description = description
    if instruction:
        grid_description = f"{description}. Context: {instruction}"
    grid_fallback = os.getenv("WALKTHROUGH_VISION_GRID_FALLBACK", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }

    try:
        image_bytes = decode_image_payload(payload.image_base64, payload.content_type)
        try:
            result = locate_element_clicky_point(
                image_bytes,
                description=description,
                instruction=instruction,
                viewport_width=payload.viewport_width,
                viewport_height=payload.viewport_height,
            )
        except VisionLocateError:
            if not grid_fallback:
                raise
            # Optional second LLM round-trip (slow).
            result = locate_element_two_stage(
                image_bytes,
                description=grid_description,
                viewport_width=payload.viewport_width,
                viewport_height=payload.viewport_height,
            )
    except VisionLocateError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except RuntimeError as exc:
        # Missing OPENAI/OPENROUTER key configuration.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        # Bad/placeholder API keys surface as OpenAI AuthenticationError (401),
        # not RuntimeError - map to 503 so the desktop client can log
        # config_missing instead of a generic HTTP 500.
        detail = str(exc)
        lowered = detail.lower()
        if (
            "api key" in lowered
            or "authentication" in lowered
            or "unauthorized" in lowered
            or "401" in lowered
        ):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=detail,
            ) from exc
        raise

    return WalkthroughLocateResponse(
        x=result.x,
        y=result.y,
        width=result.width,
        height=result.height,
        image_width=result.image_width,
        image_height=result.image_height,
        viewport_width=result.viewport_width,
        viewport_height=result.viewport_height,
        coarse_cell=result.coarse_cell,
        fine_cell=result.fine_cell,
        method=result.method,
        coaching_hint=result.coaching_hint,
    )
