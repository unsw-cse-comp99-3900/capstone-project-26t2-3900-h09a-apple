"""
HTTP routes for walkthrough K-means analytics under /api/v1/analytics.

Manager-only; thin wrappers around analytics_clustering and response schemas.
"""

from __future__ import annotations

import logging
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session as DBSession

from app import models
from app.analytics_cache import AnalyticsCache, get_analytics_cache
from app.analytics_clustering import (
    AnalyticsSopNotFoundError,
    InsufficientAnalyticsDataError,
    cluster_walkthroughs,
)
from app.analytics_schema import (
    AnalyticsClusteringMetadata,
    AnalyticsClusteringRequest,
    AnalyticsClusteringResponse,
)
from app.auth.deps import require_role
from app.database import get_db
from app.models import User, UserRole

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/analytics", tags=["analytics"])


def _tenant_sop_exists(db: DBSession, *, tenant_id: UUID, workflow_id: UUID) -> bool:
    return (
        db.query(models.Sop)
        .filter(models.Sop.id == workflow_id, models.Sop.tenant_id == tenant_id)
        .one_or_none()
        is not None
    )


def _result_from_record(record: models.ClusteringResult) -> AnalyticsClusteringResponse:
    metadata = {
        **record.analytics_metadata,
        "algorithm_version": record.algorithm_version,
        "computed_at": record.computed_at,
        "cached": False,
    }
    return AnalyticsClusteringResponse(
        workflow_id=record.workflow_id,
        k=record.k,
        clusters=record.clusters,
        assignments=record.session_cluster_assignments,
        outliers=record.outliers,
        silhouette_score=record.silhouette,
        metadata=AnalyticsClusteringMetadata.model_validate(metadata),
    )


@router.post("/kmeans", response_model=AnalyticsClusteringResponse)
def compute_kmeans(
    payload: AnalyticsClusteringRequest,
    current_user: Annotated[User, Depends(require_role(UserRole.manager))],
    db: Annotated[DBSession, Depends(get_db)],
    cache: Annotated[AnalyticsCache, Depends(get_analytics_cache)],
) -> AnalyticsClusteringResponse:
    try:
        result = cluster_walkthroughs(
            db,
            tenant_id=current_user.tenant_id,
            workflow_id=payload.workflow_id,
            k=payload.k,
            min_sessions=payload.min_sessions,
        )
        record = models.ClusteringResult(
            tenant_id=current_user.tenant_id,
            workflow_id=payload.workflow_id,
            k=payload.k,
            cluster_centers=[cluster.centroid_values for cluster in result.clusters],
            session_cluster_assignments=[
                assignment.model_dump(mode="json") for assignment in result.assignments
            ],
            clusters=[cluster.model_dump(mode="json") for cluster in result.clusters],
            outliers=[outlier.model_dump(mode="json") for outlier in result.outliers],
            silhouette=result.silhouette_score,
            analytics_metadata=result.metadata.model_dump(
                mode="json",
                exclude={"algorithm_version", "computed_at"},
            ),
            algorithm_version=result.metadata.algorithm_version,
            computed_at=result.metadata.computed_at,
        )
        db.add(record)
        db.commit()
    except AnalyticsSopNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except (InsufficientAnalyticsDataError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except Exception:
        db.rollback()
        logger.exception("K-means analytics computation or persistence failed")
        raise

    cache.set(result, tenant_id=current_user.tenant_id, workflow_id=payload.workflow_id)
    logger.info(
        "K-means analytics computed workflow_id=%s tenant_id=%s duration_ms=%d "
        "silhouette=%s sessions=%d",
        payload.workflow_id,
        current_user.tenant_id,
        result.metadata.computation_time_ms,
        result.silhouette_score,
        result.metadata.session_count,
    )
    return result


@router.get("/kmeans/{workflow_id}", response_model=AnalyticsClusteringResponse)
def get_latest_kmeans(
    workflow_id: UUID,
    current_user: Annotated[User, Depends(require_role(UserRole.manager))],
    db: Annotated[DBSession, Depends(get_db)],
    cache: Annotated[AnalyticsCache, Depends(get_analytics_cache)],
) -> AnalyticsClusteringResponse:
    cached = cache.get(tenant_id=current_user.tenant_id, workflow_id=workflow_id)
    if cached is not None:
        return cached

    if not _tenant_sop_exists(
        db,
        tenant_id=current_user.tenant_id,
        workflow_id=workflow_id,
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="SOP not found")

    record = (
        db.query(models.ClusteringResult)
        .filter(
            models.ClusteringResult.tenant_id == current_user.tenant_id,
            models.ClusteringResult.workflow_id == workflow_id,
        )
        .order_by(models.ClusteringResult.computed_at.desc())
        .first()
    )
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No clustering result found",
        )

    result = _result_from_record(record)
    cache.set(result, tenant_id=current_user.tenant_id, workflow_id=workflow_id)
    return result


__all__ = ["router"]
