"""
Walkthrough completion ingest and vision-locate helper routes.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session as DBSession

from app import models
from app.auth.deps import filter_by_tenant, require_role
from app.database import get_db
from app.friction_tasks import enqueue_friction_calculation
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


def _sop_step_numbers(raw_steps: object) -> set[int]:
    if not isinstance(raw_steps, list):
        return set()
    numbers: set[int] = set()
    for index, step in enumerate(raw_steps, start=1):
        raw_number = step.get("order", index) if isinstance(step, dict) else index
        try:
            number = int(raw_number)
        except (TypeError, ValueError):
            continue
        if number >= 1:
            numbers.add(number)
    return numbers


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

    valid_step_numbers = _sop_step_numbers(sop.steps)
    invalid_step_numbers = sorted(set(payload.step_sequence) - valid_step_numbers)
    if invalid_step_numbers:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"step_sequence contains steps not in SOP: {invalid_step_numbers}",
        )

    user_role = (
        current_user.role.value
        if isinstance(current_user.role, UserRole)
        else str(current_user.role)
    )

    friction_analysis: models.FrictionAnalysis | None = None
    try:
        completion = models.WalkthroughCompletion(
            tenant_id=current_user.tenant_id,
            sop_id=sop.id,
            employee_id=current_user.id,
            completed_at=payload.completed_at,
            duration_seconds=payload.duration_seconds,
            step_sequence=payload.step_sequence,
            user_role=user_role,
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

        # Friction scores are driven by walkthrough evidence. Recompute after each
        # completion on published SOPs so the variance dashboard stays current.
        if sop.status == models.SopStatus.published.value:
            friction_analysis = models.FrictionAnalysis(
                id=uuid4(),
                tenant_id=current_user.tenant_id,
                sop_id=sop.id,
                status=models.FrictionAnalysisStatus.pending.value,
            )
            db.add(friction_analysis)

        db.commit()

    except Exception:
        db.rollback()
        raise

    if friction_analysis is not None:
        try:
            enqueue_friction_calculation(friction_analysis.id)
        except Exception as exc:
            friction_analysis.status = models.FrictionAnalysisStatus.failed.value
            friction_analysis.error_message = (f"Could not enqueue friction calculation: {exc}")[
                :2000
            ]
            friction_analysis.completed_at = datetime.now(UTC)
            db.commit()

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
    """Locate a described element via two-stage vision grid (H09AAPPLE-53).

    API keys stay on the server. The extension only sends a viewport screenshot
    and receives viewport-space pixel bounds.
    """
    _ = current_user  # auth + tenant gate only; no cross-tenant image store

    description = payload.description.strip()
    if payload.instruction and payload.instruction.strip():
        description = f"{description}. Context: {payload.instruction.strip()}"

    try:
        image_bytes = decode_image_payload(payload.image_base64, payload.content_type)
        result = locate_element_two_stage(
            image_bytes,
            description=description,
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
    )
