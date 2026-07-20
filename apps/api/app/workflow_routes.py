from __future__ import annotations

from typing import Annotated
from urllib.parse import unquote

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session as DBSession

from app.auth.deps import require_role
from app.database import get_db
from app.models import User, UserRole
from app.workflow_cluster_schema import WorkflowClusterResponse
from app.workflow_clustering import InsufficientClusterDataError, cluster_workflow

router = APIRouter(
    prefix="/api/v1/workflows",
    tags=["workflows"],
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
