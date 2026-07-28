from __future__ import annotations

from collections import defaultdict
from typing import Annotated
from uuid import UUID

import redis.asyncio as async_redis
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status
from sqlalchemy.orm import Session as DBSession

from app import models
from app.auth.deps import require_role
from app.auth.jwt import InvalidTokenError, verify_token
from app.database import get_db
from app.friction_model import average_score
from app.friction_notifications import friction_channel
from app.friction_schema import (
    FrictionAnalysisResponse,
    FrictionEmployeeStepResponse,
    FrictionEmployeeSummary,
    FrictionStepAggregateResponse,
)
from app.models import User, UserRole

router = APIRouter(prefix="/api/v1/analytics/friction", tags=["friction"])


def _step_titles(sop: models.Sop) -> dict[int, str]:
    titles: dict[int, str] = {}
    for index, step in enumerate(sop.steps, start=1):
        try:
            number = int(step.get("order", index))
        except (TypeError, ValueError):
            number = index
        title = step.get("title")
        titles[number] = str(title) if title else f"Step {number}"
    return titles


def _analysis_response(
    db: DBSession,
    analysis: models.FrictionAnalysis,
    sop: models.Sop,
) -> FrictionAnalysisResponse:
    score_rows = (
        db.query(models.FrictionEmployeeStepScore)
        .filter(models.FrictionEmployeeStepScore.analysis_id == analysis.id)
        .order_by(
            models.FrictionEmployeeStepScore.step_number,
            models.FrictionEmployeeStepScore.employee_id,
        )
        .all()
    )
    aggregates = (
        db.query(models.FrictionStepAggregate)
        .filter(models.FrictionStepAggregate.analysis_id == analysis.id)
        .order_by(models.FrictionStepAggregate.step_number)
        .all()
    )
    employee_ids = {row.employee_id for row in score_rows}
    employee_ids.update(
        employee_id
        for row in aggregates
        for employee_id in (row.best_employee_id, row.worst_employee_id)
        if employee_id is not None
    )
    users = (
        db.query(models.User).filter(models.User.id.in_(employee_ids)).all() if employee_ids else []
    )
    emails = {user.id: user.email for user in users}
    titles = _step_titles(sop)

    scores_by_employee: dict[UUID, list[models.FrictionEmployeeStepScore]] = defaultdict(list)
    for row in score_rows:
        scores_by_employee[row.employee_id].append(row)

    employee_summaries = []
    for employee_id, rows in scores_by_employee.items():
        highest = max(rows, key=lambda row: (float(row.score), -row.step_number))
        employee_summaries.append(
            FrictionEmployeeSummary(
                employee_id=employee_id,
                employee_email=emails.get(employee_id),
                average_score=average_score([float(row.score) for row in rows]),
                highest_friction_step=highest.step_number,
            )
        )
    employee_summaries.sort(key=lambda item: (-item.average_score, str(item.employee_id)))

    return FrictionAnalysisResponse(
        analysis_id=analysis.id,
        sop_id=analysis.sop_id,
        status=analysis.status,
        overall_score=(
            float(analysis.overall_score) if analysis.overall_score is not None else None
        ),
        highest_friction_step=analysis.highest_friction_step,
        employee_count=analysis.employee_count,
        algorithm_version=analysis.algorithm_version,
        error_message=analysis.error_message,
        triggered_at=analysis.triggered_at,
        started_at=analysis.started_at,
        completed_at=analysis.completed_at,
        steps=[
            FrictionStepAggregateResponse(
                step_number=row.step_number,
                step_title=titles.get(row.step_number),
                average_score=float(row.average_score),
                min_score=float(row.min_score),
                max_score=float(row.max_score),
                best_employee_id=row.best_employee_id,
                best_employee_email=emails.get(row.best_employee_id),
                worst_employee_id=row.worst_employee_id,
                worst_employee_email=emails.get(row.worst_employee_id),
                sample_size=row.sample_size,
            )
            for row in aggregates
        ],
        employees=employee_summaries,
        employee_step_scores=[
            FrictionEmployeeStepResponse(
                employee_id=row.employee_id,
                employee_email=emails.get(row.employee_id),
                completion_id=row.completion_id,
                step_number=row.step_number,
                duration_ms=row.duration_ms,
                expected_duration_ms=row.expected_duration_ms,
                retry_count=row.retry_count,
                path_deviation_count=row.path_deviation_count,
                score=float(row.score),
                is_outlier=row.is_outlier,
            )
            for row in score_rows
        ],
    )


@router.get("/{sop_id}", response_model=FrictionAnalysisResponse)
def get_latest_friction_analysis(
    sop_id: UUID,
    current_user: Annotated[User, Depends(require_role(UserRole.reviewer))],
    db: Annotated[DBSession, Depends(get_db)],
) -> FrictionAnalysisResponse:
    sop = (
        db.query(models.Sop)
        .filter(models.Sop.id == sop_id, models.Sop.tenant_id == current_user.tenant_id)
        .one_or_none()
    )
    if sop is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="SOP not found")
    analysis = (
        db.query(models.FrictionAnalysis)
        .filter(
            models.FrictionAnalysis.sop_id == sop_id,
            models.FrictionAnalysis.tenant_id == current_user.tenant_id,
        )
        .order_by(models.FrictionAnalysis.triggered_at.desc())
        .first()
    )
    if analysis is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No friction analysis found",
        )
    return _analysis_response(db, analysis, sop)


def _websocket_identity(websocket: WebSocket) -> dict[str, str]:
    token = websocket.cookies.get("wt_access_token") or websocket.query_params.get("token")
    if not token:
        raise InvalidTokenError("Missing access token")
    identity = verify_token(token)
    if identity.get("role") not in (UserRole.reviewer.value, UserRole.manager.value):
        raise InvalidTokenError("Reviewer role or higher required")
    UUID(identity["tenant_id"])
    return identity


@router.websocket("/ws")
async def friction_updates(websocket: WebSocket) -> None:
    try:
        identity = _websocket_identity(websocket)
    except (InvalidTokenError, ValueError):
        await websocket.close(code=1008, reason="Not authenticated")
        return

    await websocket.accept()
    client = async_redis.Redis.from_url(
        __import__("os").getenv("REDIS_URL", "redis://localhost:6379/0"),
        decode_responses=True,
    )
    pubsub = client.pubsub()
    try:
        await pubsub.subscribe(friction_channel(identity["tenant_id"]))
        while True:
            message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=20)
            if message and message.get("type") == "message":
                await websocket.send_text(message["data"])
            else:
                await websocket.send_json({"event": "ping"})
    except WebSocketDisconnect:
        pass
    finally:
        await pubsub.aclose()
        await client.aclose()


__all__ = ["router"]
