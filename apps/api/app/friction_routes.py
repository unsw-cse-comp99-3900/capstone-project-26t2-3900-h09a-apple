from __future__ import annotations

from collections import defaultdict
from typing import Annotated
from uuid import UUID

import redis.asyncio as async_redis
from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from sqlalchemy.orm import Session as DBSession

from app import models
from app.auth.deps import require_role
from app.auth.jwt import (
    WS_TOKEN_EXPIRE_SECONDS,
    InvalidTokenError,
    generate_ws_ticket,
    verify_access_or_ws_token,
)
from app.database import get_db
from app.friction_insight import build_insight_summary, first_sentence, step_titles
from app.friction_model import average_score
from app.friction_notifications import friction_channel
from app.friction_schema import (
    FrictionAnalysisResponse,
    FrictionEmployeeStepResponse,
    FrictionEmployeeSummary,
    FrictionStepAggregateResponse,
    FrictionStepChartPoint,
    FrictionWorkflowListResponse,
    FrictionWorkflowSummary,
    FrictionWsTicketResponse,
)
from app.models import User, UserRole

router = APIRouter(prefix="/api/v1/analytics/friction", tags=["friction"])


def _outlier_steps(db: DBSession, analysis_id: UUID) -> set[int]:
    rows = (
        db.query(models.FrictionEmployeeStepScore.step_number)
        .filter(
            models.FrictionEmployeeStepScore.analysis_id == analysis_id,
            models.FrictionEmployeeStepScore.is_outlier.is_(True),
        )
        .distinct()
        .all()
    )
    return {int(row[0]) for row in rows}


def _step_chart_points(
    db: DBSession,
    analysis: models.FrictionAnalysis,
    titles: dict[int, str],
) -> tuple[list[FrictionStepChartPoint], bool]:
    aggregates = (
        db.query(models.FrictionStepAggregate)
        .filter(models.FrictionStepAggregate.analysis_id == analysis.id)
        .order_by(models.FrictionStepAggregate.step_number)
        .all()
    )
    flagged = _outlier_steps(db, analysis.id)
    points = [
        FrictionStepChartPoint(
            step_number=int(row.step_number),
            step_title=titles.get(int(row.step_number)),
            average_score=float(row.average_score),
            variance_flag=int(row.step_number) in flagged,
        )
        for row in aggregates
    ]
    return points, any(point.variance_flag for point in points)


def _workflow_summary(
    db: DBSession,
    sop: models.Sop,
    analysis: models.FrictionAnalysis | None,
) -> FrictionWorkflowSummary:
    titles = step_titles(sop)
    if analysis is None:
        return FrictionWorkflowSummary(
            workflow_id=sop.id,
            title=sop.title,
            status=None,
            overall_score=None,
            session_count=0,
            high_variance=False,
            highest_friction_step=None,
            insight_teaser=None,
            insight_status="pending",
            steps=[],
        )

    steps, high_variance = _step_chart_points(db, analysis, titles)
    insight_status = analysis.status
    insight_teaser = None
    if analysis.status == models.FrictionAnalysisStatus.completed.value:
        summary = build_insight_summary(
            sop_title=sop.title,
            analysis=analysis,
            step_titles=titles,
        )
        insight_teaser = first_sentence(summary) or summary
        insight_status = "ready"
    elif analysis.status == models.FrictionAnalysisStatus.failed.value:
        insight_status = "failed"

    return FrictionWorkflowSummary(
        workflow_id=sop.id,
        title=sop.title,
        status=analysis.status,
        overall_score=(
            float(analysis.overall_score) if analysis.overall_score is not None else None
        ),
        session_count=int(analysis.employee_count or 0),
        high_variance=high_variance,
        highest_friction_step=analysis.highest_friction_step,
        insight_teaser=insight_teaser,
        insight_status=insight_status,
        steps=steps,
    )


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
    titles = step_titles(sop)

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


@router.get("", response_model=FrictionWorkflowListResponse)
def list_friction_workflows(
    current_user: Annotated[User, Depends(require_role(UserRole.reviewer))],
    db: Annotated[DBSession, Depends(get_db)],
) -> FrictionWorkflowListResponse:
    """Ranked PII-free friction summaries for all published workflows."""
    sops = (
        db.query(models.Sop)
        .filter(
            models.Sop.tenant_id == current_user.tenant_id,
            models.Sop.status == models.SopStatus.published.value,
        )
        .order_by(models.Sop.title.asc())
        .all()
    )
    summaries: list[FrictionWorkflowSummary] = []
    for sop in sops:
        analysis = (
            db.query(models.FrictionAnalysis)
            .filter(
                models.FrictionAnalysis.sop_id == sop.id,
                models.FrictionAnalysis.tenant_id == current_user.tenant_id,
            )
            .order_by(models.FrictionAnalysis.triggered_at.desc())
            .first()
        )
        summaries.append(_workflow_summary(db, sop, analysis))

    summaries.sort(
        key=lambda item: (
            item.overall_score is None,
            -(item.overall_score or 0.0),
            item.title.lower(),
        )
    )
    return FrictionWorkflowListResponse(workflows=summaries)


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


@router.post("/ws-ticket", response_model=FrictionWsTicketResponse)
def create_friction_ws_ticket(
    current_user: Annotated[User, Depends(require_role(UserRole.reviewer))],
) -> FrictionWsTicketResponse:
    try:
        role = UserRole(current_user.role)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid user role",
        ) from exc
    return FrictionWsTicketResponse(
        ticket=generate_ws_ticket(current_user.id, role, current_user.tenant_id),
        expires_in_seconds=WS_TOKEN_EXPIRE_SECONDS,
    )


@router.websocket("/ws")
async def friction_updates(
    websocket: WebSocket,
    db: Annotated[DBSession, Depends(get_db)],
    token: Annotated[str | None, Query()] = None,
) -> None:
    auth_header = websocket.headers.get("authorization")
    header_token = None
    if auth_header and auth_header.lower().startswith("bearer "):
        header_token = auth_header.split(" ", 1)[1].strip() or None
    resolved = token or header_token or websocket.cookies.get("wt_access_token")
    if not resolved:
        await websocket.close(code=4401)
        return
    try:
        identity = verify_access_or_ws_token(resolved)
        user_id = UUID(identity["user_id"])
    except (InvalidTokenError, KeyError, ValueError):
        await websocket.close(code=4401)
        return

    user = db.query(models.User).filter(models.User.id == user_id).first()
    if user is None:
        await websocket.close(code=4401)
        return
    try:
        role = UserRole(user.role)
    except ValueError:
        await websocket.close(code=4403)
        return
    if role not in {UserRole.reviewer, UserRole.manager}:
        await websocket.close(code=4403)
        return

    await websocket.accept()
    client = async_redis.Redis.from_url(
        __import__("os").getenv("REDIS_URL", "redis://localhost:6379/0"),
        decode_responses=True,
    )
    pubsub = client.pubsub()
    try:
        await pubsub.subscribe(friction_channel(user.tenant_id))
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
