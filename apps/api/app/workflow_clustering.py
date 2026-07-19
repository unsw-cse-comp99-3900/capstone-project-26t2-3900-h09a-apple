from __future__ import annotations

import logging
import time
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID, uuid4

import numpy as np
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from sklearn.metrics.pairwise import cosine_distances
from sqlalchemy.orm import Session as DBSession

from app import models
from app.auth.deps import filter_by_tenant
from app.workflow_cluster_schema import (
    ClusterSessionAssignment,
    StepVarianceItem,
    WorkflowClusterResponse,
)

logger = logging.getLogger(__name__)

HIGH_VARIANCE_THRESHOLD = 0.25
CANDIDATE_K = (2, 3, 4)
MIN_SESSIONS_FOR_CLUSTERING = 3
EMBEDDING_DIM = 1536


class InsufficientClusterDataError(Exception):
    """Fewer than the minimum number of eligible sessions for clustering."""


@dataclass(frozen=True)
class SessionEmbeddingBundle:
    session_id: UUID
    sop_id: UUID
    step_vectors: dict[int, list[float]]


def _as_float_vector(raw: object) -> list[float]:
    if raw is None:
        raise ValueError("embedding is null")
    values = list(raw)
    if len(values) != EMBEDDING_DIM:
        raise ValueError(f"expected {EMBEDDING_DIM}-d embedding, got {len(values)}")
    return [float(value) for value in values]


def mean_pool_session_vector(step_vectors: Sequence[Sequence[float]]) -> np.ndarray:
    matrix = np.asarray(step_vectors, dtype=np.float64)
    if matrix.ndim != 2 or matrix.shape[0] == 0:
        raise ValueError("session has no step embeddings to pool")
    pooled = matrix.mean(axis=0)
    norm = float(np.linalg.norm(pooled))
    if norm > 0:
        pooled = pooled / norm
    return pooled


def cosine_distance(left: np.ndarray, right: np.ndarray) -> float:
    left_2d = np.asarray(left, dtype=np.float64).reshape(1, -1)
    right_2d = np.asarray(right, dtype=np.float64).reshape(1, -1)
    return float(cosine_distances(left_2d, right_2d)[0, 0])


def mean_pairwise_cosine_distance(vectors: Sequence[Sequence[float]]) -> float:
    if len(vectors) < 2:
        return 0.0
    matrix = np.asarray(vectors, dtype=np.float64)
    distances = cosine_distances(matrix)
    upper = distances[np.triu_indices(len(vectors), k=1)]
    if upper.size == 0:
        return 0.0
    return float(np.mean(upper))


def candidate_k_values(session_count: int) -> list[int]:
    return [k for k in CANDIDATE_K if k < session_count]


def select_kmeans_model(
    session_matrix: np.ndarray,
) -> tuple[int, float, dict[int, float], np.ndarray, np.ndarray]:
    n_samples = session_matrix.shape[0]
    candidates = candidate_k_values(n_samples)
    if not candidates:
        raise InsufficientClusterDataError(
            f"Need at least {MIN_SESSIONS_FOR_CLUSTERING} sessions with complete embeddings"
        )

    best_k: int | None = None
    best_score = float("-inf")
    best_labels: np.ndarray | None = None
    best_centroids: np.ndarray | None = None
    scores: dict[int, float] = {}

    for k in candidates:
        model = KMeans(n_clusters=k, n_init=10, random_state=42)
        labels = model.fit_predict(session_matrix)
        if len(set(labels.tolist())) < 2:
            continue
        score = float(silhouette_score(session_matrix, labels, metric="euclidean"))
        scores[k] = score
        logger.info(
            "workflow clustering candidate k=%s silhouette=%.6f n_sessions=%s",
            k,
            score,
            n_samples,
        )
        if score > best_score:
            best_k = k
            best_score = score
            best_labels = labels
            best_centroids = model.cluster_centers_

    if best_k is None or best_labels is None or best_centroids is None:
        raise InsufficientClusterDataError("Unable to fit a stable KMeans model for this workflow")

    logger.info(
        "workflow clustering selected k=%s silhouette=%.6f candidates=%s",
        best_k,
        best_score,
        scores,
    )
    return best_k, best_score, scores, best_labels, best_centroids


def load_eligible_session_bundles(
    db: DBSession,
    *,
    tenant_id: UUID,
    workflow_name: str,
) -> list[SessionEmbeddingBundle]:
    rows = (
        filter_by_tenant(db.query(models.Sop), models.Sop, tenant_id)
        .join(models.Session, models.Sop.session_id == models.Session.id)
        .filter(
            models.Session.workflow_name == workflow_name,
            models.Sop.status == models.SopStatus.published.value,
            models.Sop.embedding_status == models.EmbeddingStatus.complete.value,
        )
        .all()
    )

    bundles: list[SessionEmbeddingBundle] = []
    for sop in rows:
        embeddings = (
            db.query(models.SopStepEmbedding)
            .filter(models.SopStepEmbedding.sop_id == sop.id)
            .order_by(models.SopStepEmbedding.step_number.asc())
            .all()
        )
        if not embeddings:
            continue
        step_vectors = {int(row.step_number): _as_float_vector(row.embedding) for row in embeddings}
        bundles.append(
            SessionEmbeddingBundle(
                session_id=sop.session_id,
                sop_id=sop.id,
                step_vectors=step_vectors,
            )
        )
    return bundles


def compute_step_variance(
    bundles: Sequence[SessionEmbeddingBundle],
) -> list[StepVarianceItem]:
    by_step: dict[int, list[list[float]]] = {}
    for bundle in bundles:
        for step_number, vector in bundle.step_vectors.items():
            by_step.setdefault(step_number, []).append(vector)

    items = [
        StepVarianceItem(
            step_number=step_number,
            semantic_variance=mean_pairwise_cosine_distance(vectors),
        )
        for step_number, vectors in sorted(by_step.items())
    ]
    return items


def cluster_workflow(
    db: DBSession,
    *,
    tenant_id: UUID,
    workflow_name: str,
) -> WorkflowClusterResponse:
    started = time.perf_counter()
    trimmed_name = workflow_name.strip()
    if not trimmed_name:
        raise ValueError("workflow_id must be a non-empty workflow name")

    bundles = load_eligible_session_bundles(
        db,
        tenant_id=tenant_id,
        workflow_name=trimmed_name,
    )
    if len(bundles) < MIN_SESSIONS_FOR_CLUSTERING:
        raise InsufficientClusterDataError(
            f"Need at least {MIN_SESSIONS_FOR_CLUSTERING} published sessions "
            "with embedding_status=complete"
        )

    pooled = [mean_pool_session_vector(list(bundle.step_vectors.values())) for bundle in bundles]
    session_matrix = np.vstack(pooled)

    chosen_k, chosen_silhouette, scores, labels, centroids = select_kmeans_model(session_matrix)

    assignments: list[ClusterSessionAssignment] = []
    members_by_cluster: dict[int, list[str]] = {index: [] for index in range(chosen_k)}
    high_variance_by_cluster: dict[int, list[str]] = {index: [] for index in range(chosen_k)}

    for index, bundle in enumerate(bundles):
        cluster_id = int(labels[index])
        distance = cosine_distance(session_matrix[index], centroids[cluster_id])
        is_high_variance = distance > HIGH_VARIANCE_THRESHOLD
        session_id = str(bundle.session_id)
        members_by_cluster[cluster_id].append(session_id)
        if is_high_variance:
            high_variance_by_cluster[cluster_id].append(session_id)
        assignments.append(
            ClusterSessionAssignment(
                session_id=session_id,
                sop_id=str(bundle.sop_id),
                cluster_id=cluster_id,
                distance_to_centroid=distance,
                is_high_variance=is_high_variance,
            )
        )

    step_variance = compute_step_variance(bundles)
    run_id = uuid4()
    score_payload = {str(k): float(v) for k, v in sorted(scores.items())}

    db.query(models.WorkflowCluster).filter(
        models.WorkflowCluster.tenant_id == tenant_id,
        models.WorkflowCluster.workflow_name == trimmed_name,
    ).delete(synchronize_session=False)
    db.query(models.WorkflowStepVariance).filter(
        models.WorkflowStepVariance.tenant_id == tenant_id,
        models.WorkflowStepVariance.workflow_name == trimmed_name,
    ).delete(synchronize_session=False)

    for cluster_id in range(chosen_k):
        db.add(
            models.WorkflowCluster(
                id=uuid4(),
                tenant_id=tenant_id,
                workflow_name=trimmed_name,
                run_id=run_id,
                cluster_id=cluster_id,
                chosen_k=chosen_k,
                chosen_silhouette=Decimal(str(round(chosen_silhouette, 8))),
                candidate_silhouettes=score_payload,
                centroid_vector=centroids[cluster_id].astype(float).tolist(),
                member_session_ids=members_by_cluster[cluster_id],
                high_variance_session_ids=high_variance_by_cluster[cluster_id],
                created_at=datetime.now(UTC),
            )
        )

    now = datetime.now(UTC)
    for item in step_variance:
        db.add(
            models.WorkflowStepVariance(
                id=uuid4(),
                tenant_id=tenant_id,
                workflow_name=trimmed_name,
                run_id=run_id,
                step_number=item.step_number,
                semantic_variance=Decimal(str(round(item.semantic_variance, 8))),
                updated_at=now,
            )
        )

    db.commit()

    elapsed_ms = int((time.perf_counter() - started) * 1000)
    return WorkflowClusterResponse(
        workflow_id=trimmed_name,
        workflow_name=trimmed_name,
        run_id=str(run_id),
        chosen_k=chosen_k,
        chosen_silhouette=chosen_silhouette,
        silhouette_scores=score_payload,
        high_variance_threshold=HIGH_VARIANCE_THRESHOLD,
        session_count=len(bundles),
        assignments=assignments,
        step_variance=step_variance,
        elapsed_ms=elapsed_ms,
    )
