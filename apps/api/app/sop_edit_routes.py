"""Reviewer SOP step description edits with audit log (H09AAPPLE-57)."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session as DBSession
from sqlalchemy.orm.attributes import flag_modified

from app import models
from app.auth.deps import filter_by_tenant, require_role
from app.database import get_db
from app.models import User, UserRole

router = APIRouter(prefix="/api/v1/sops", tags=["sop-edits"])


class SopStepEditRequest(BaseModel):
    instruction: str = Field(..., min_length=1)


class SopStepEditResponse(BaseModel):
    sop_id: str
    step_number: int
    instruction: str
    edit_id: str
    edited_at: datetime


class SopStepEditLogItem(BaseModel):
    id: str
    step_number: int
    editor_id: str | None
    before_text: str
    after_text: str
    created_at: datetime


class SopStepEditLogListResponse(BaseModel):
    sop_id: str
    edits: list[SopStepEditLogItem]


def _step_index(steps: list[object], step_number: int) -> int:
    for index, raw in enumerate(steps):
        if not isinstance(raw, dict):
            continue
        order = raw.get("order", index + 1)
        try:
            if int(order) == step_number:
                return index
        except (TypeError, ValueError):
            continue
    if 1 <= step_number <= len(steps):
        return step_number - 1
    raise HTTPException(status_code=404, detail="SOP step not found")


@router.patch(
    "/{sop_id}/steps/{step_number}",
    response_model=SopStepEditResponse,
)
def edit_sop_step_instruction(
    sop_id: UUID,
    step_number: int,
    payload: SopStepEditRequest,
    current_user: Annotated[User, Depends(require_role(UserRole.reviewer))],
    db: Annotated[DBSession, Depends(get_db)],
) -> SopStepEditResponse:
    if step_number < 1:
        raise HTTPException(status_code=400, detail="step_number must be >= 1")

    sop = (
        filter_by_tenant(db.query(models.Sop), models.Sop, current_user.tenant_id)
        .filter(models.Sop.id == sop_id)
        .first()
    )
    if sop is None:
        raise HTTPException(status_code=404, detail="SOP not found")

    steps = list(sop.steps or [])
    if not steps:
        raise HTTPException(status_code=404, detail="SOP has no steps")

    index = _step_index(steps, step_number)
    step = dict(steps[index]) if isinstance(steps[index], dict) else {}
    before = str(step.get("instruction") or "")
    after = payload.instruction.strip()
    if not after:
        raise HTTPException(status_code=400, detail="instruction must not be empty")
    if before == after:
        raise HTTPException(status_code=400, detail="instruction is unchanged")

    step["instruction"] = after
    if "order" not in step:
        step["order"] = step_number
    steps[index] = step
    sop.steps = steps
    flag_modified(sop, "steps")

    log = models.SopStepEditLog(
        tenant_id=current_user.tenant_id,
        sop_id=sop.id,
        step_number=step_number,
        editor_id=current_user.id,
        before_text=before,
        after_text=after,
    )
    db.add(log)
    db.commit()
    db.refresh(log)

    return SopStepEditResponse(
        sop_id=str(sop.id),
        step_number=step_number,
        instruction=after,
        edit_id=str(log.id),
        edited_at=log.created_at,
    )


@router.get(
    "/{sop_id}/step-edits",
    response_model=SopStepEditLogListResponse,
)
def list_sop_step_edits(
    sop_id: UUID,
    current_user: Annotated[User, Depends(require_role(UserRole.reviewer))],
    db: Annotated[DBSession, Depends(get_db)],
) -> SopStepEditLogListResponse:
    sop = (
        filter_by_tenant(db.query(models.Sop), models.Sop, current_user.tenant_id)
        .filter(models.Sop.id == sop_id)
        .first()
    )
    if sop is None:
        raise HTTPException(status_code=404, detail="SOP not found")

    rows = (
        filter_by_tenant(
            db.query(models.SopStepEditLog), models.SopStepEditLog, current_user.tenant_id
        )
        .filter(models.SopStepEditLog.sop_id == sop_id)
        .order_by(models.SopStepEditLog.created_at.desc())
        .limit(100)
        .all()
    )
    return SopStepEditLogListResponse(
        sop_id=str(sop_id),
        edits=[
            SopStepEditLogItem(
                id=str(row.id),
                step_number=int(row.step_number),
                editor_id=str(row.editor_id) if row.editor_id else None,
                before_text=row.before_text,
                after_text=row.after_text,
                created_at=row.created_at,
            )
            for row in rows
        ],
    )


__all__ = ["router"]
