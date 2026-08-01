from __future__ import annotations

from typing import Annotated
from urllib.parse import unquote
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session as DBSession

from app import models
from app.auth.deps import require_role
from app.database import get_db
from app.friction_insight import build_insight_summary, first_sentence, step_titles
from app.friction_schema import WorkflowInsightSummaryResponse
from app.models import User, UserRole
from app.workflow_cluster_schema import WorkflowClusterResponse
from app.workflow_clustering import InsufficientClusterDataError, cluster_workflow

router = APIRouter(
    prefix="/api/v1/workflows",
    tags=["workflows"],
)


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
