from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated
from urllib.parse import unquote
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session as DBSession

from app import models
from app.auth.deps import require_role
from app.database import get_db
from app.friction_calculation import FrictionCalculationError, calculate_friction_analysis
from app.friction_insight import build_insight_summary, first_sentence, step_titles
from app.friction_notifications import publish_friction_update
from app.friction_schema import FrictionRecalculateResponse, WorkflowInsightSummaryResponse
from app.models import User, UserRole
from app.workflow_cluster_schema import WorkflowClusterResponse, WorkflowClusterTimingsResponse
from app.workflow_cluster_timings import load_workflow_cluster_timings
from app.workflow_clustering import InsufficientClusterDataError, cluster_workflow

router = APIRouter(
    prefix="/api/v1/workflows",
    tags=["workflows"],
)


def _friction_update_payload(analysis: models.FrictionAnalysis) -> dict:
    return {
        "event": "friction_analysis.updated",
        "analysis_id": str(analysis.id),
        "sop_id": str(analysis.sop_id),
        "status": analysis.status,
        "overall_score": (
            float(analysis.overall_score) if analysis.overall_score is not None else None
        ),
        "highest_friction_step": analysis.highest_friction_step,
        "employee_count": analysis.employee_count,
        "completed_at": analysis.completed_at.isoformat() if analysis.completed_at else None,
    }


@router.post(
    "/{workflow_id}/friction/recalculate",
    response_model=FrictionRecalculateResponse,
)
def recalculate_workflow_friction(
    workflow_id: str,
    current_user: Annotated[User, Depends(require_role(UserRole.manager))],
    db: Annotated[DBSession, Depends(get_db)],
) -> FrictionRecalculateResponse:
    """Recompute friction scores for a published SOP and return when finished.

    Runs synchronously so the variance detail page can refresh heatmap / insight /
    charts without a full reload after the POST completes.
    """
    try:
        sop_id = UUID(unquote(workflow_id).strip())
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="workflow_id must be a SOP UUID",
        ) from exc

    sop = (
        db.query(models.Sop)
        .filter(models.Sop.id == sop_id, models.Sop.tenant_id == current_user.tenant_id)
        .one_or_none()
    )
    if sop is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="SOP not found")
    if sop.status != models.SopStatus.published.value:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="SOP must be published before friction can be recalculated",
        )

    analysis = models.FrictionAnalysis(
        id=uuid4(),
        tenant_id=current_user.tenant_id,
        sop_id=sop.id,
        status=models.FrictionAnalysisStatus.processing.value,
        started_at=datetime.now(UTC),
    )
    db.add(analysis)
    db.commit()
    db.refresh(analysis)

    try:
        calculate_friction_analysis(db, analysis)
        analysis.status = models.FrictionAnalysisStatus.completed.value
        analysis.completed_at = datetime.now(UTC)
        analysis.error_message = None
        db.commit()
        db.refresh(analysis)
    except FrictionCalculationError as exc:
        analysis.status = models.FrictionAnalysisStatus.failed.value
        analysis.error_message = str(exc)[:2000]
        analysis.completed_at = datetime.now(UTC)
        db.commit()
        publish_friction_update(analysis.tenant_id, _friction_update_payload(analysis))
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        analysis.status = models.FrictionAnalysisStatus.failed.value
        analysis.error_message = str(exc)[:2000]
        analysis.completed_at = datetime.now(UTC)
        db.commit()
        publish_friction_update(analysis.tenant_id, _friction_update_payload(analysis))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Friction recalculation failed",
        ) from exc

    publish_friction_update(analysis.tenant_id, _friction_update_payload(analysis))
    return FrictionRecalculateResponse(
        workflow_id=sop.id,
        analysis_id=analysis.id,
        status=analysis.status,
        overall_score=(
            float(analysis.overall_score) if analysis.overall_score is not None else None
        ),
        employee_count=int(analysis.employee_count or 0),
    )


@router.get(
    "/{workflow_id}/cluster-timings",
    response_model=WorkflowClusterTimingsResponse,
)
def get_workflow_cluster_timings(
    workflow_id: str,
    current_user: Annotated[User, Depends(require_role(UserRole.manager))],
    db: Annotated[DBSession, Depends(get_db)],
) -> WorkflowClusterTimingsResponse:
    """Return per-cluster mean step timings for path comparison charts.

    ``workflow_id`` is the published SOP UUID (same as the variance detail page).
    Recording session IDs from ``workflow_clusters`` are bridged to walkthrough
    completions via ``sops.session_id``.
    """
    try:
        sop_id = UUID(unquote(workflow_id).strip())
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="workflow_id must be a SOP UUID",
        ) from exc

    payload = load_workflow_cluster_timings(
        db,
        tenant_id=current_user.tenant_id,
        sop_id=sop_id,
    )
    if payload is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="SOP not found")
    return payload


@router.get(
    "/{workflow_id}/insight-summary",
    response_model=WorkflowInsightSummaryResponse,
)
def get_workflow_insight_summary(
    workflow_id: str,
    current_user: Annotated[User, Depends(require_role(UserRole.manager))],
    db: Annotated[DBSession, Depends(get_db)],
) -> WorkflowInsightSummaryResponse:
    """Return the executive friction insight for a published SOP (workflow)."""
    try:
        sop_id = UUID(unquote(workflow_id).strip())
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="workflow_id must be a SOP UUID",
        ) from exc

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
            models.FrictionAnalysis.sop_id == sop.id,
            models.FrictionAnalysis.tenant_id == current_user.tenant_id,
        )
        .order_by(models.FrictionAnalysis.triggered_at.desc())
        .first()
    )
    if analysis is None:
        return WorkflowInsightSummaryResponse(
            workflow_id=sop.id,
            status="pending",
            summary=None,
            teaser=None,
        )
    if analysis.status != models.FrictionAnalysisStatus.completed.value:
        return WorkflowInsightSummaryResponse(
            workflow_id=sop.id,
            status=analysis.status,
            summary=None,
            teaser=None,
        )

    summary = build_insight_summary(
        sop_title=sop.title,
        analysis=analysis,
        step_titles=step_titles(sop),
    )
    return WorkflowInsightSummaryResponse(
        workflow_id=sop.id,
        status="ready",
        summary=summary,
        teaser=first_sentence(summary) or summary,
    )


@router.post(
    "/{workflow_id}/cluster",
    response_model=WorkflowClusterResponse,
)
def cluster_workflow_sessions(
    workflow_id: str,
    current_user: Annotated[User, Depends(require_role(UserRole.manager))],
    db: Annotated[DBSession, Depends(get_db)],
) -> WorkflowClusterResponse:
    """Cluster published sessions for a workflow by mean-pooled step embeddings.

    ``workflow_id`` is the session ``workflow_name`` (URL-encoded). Only SOPs with
    ``status=published`` and ``embedding_status=complete`` are included.
    """
    workflow_name = unquote(workflow_id).strip()
    if not workflow_name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="workflow_id must be a non-empty workflow name",
        )

    try:
        return cluster_workflow(
            db,
            tenant_id=current_user.tenant_id,
            workflow_name=workflow_name,
        )
    except InsufficientClusterDataError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
