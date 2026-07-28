from __future__ import annotations

import time
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from uuid import UUID

import numpy as np
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from sklearn.preprocessing import StandardScaler
from sqlalchemy.orm import Session as DBSession

from app import models
from app.analytics_schema import (
    AnalyticsAssignment,
    AnalyticsCluster,
    AnalyticsClusteringMetadata,
    AnalyticsClusteringResponse,
    AnalyticsOutlier,
)

ALGORITHM_VERSION = "walkthrough-kmeans-v2"
DEFAULT_CLUSTER_COUNT = 3
DEFAULT_MIN_SESSIONS = 5
FRICTION_TYPES = tuple(item.value for item in models.WalkthroughFrictionType)


class InsufficientAnalyticsDataError(ValueError):
    """The SOP has too few eligible walkthrough sessions to cluster."""


class AnalyticsSopNotFoundError(ValueError):
    """The requested SOP does not exist for the current tenant."""


@dataclass(frozen=True)
class WalkthroughSessionData:
    session_id: UUID
    employee_id: UUID
    total_duration_ms: int
    step_durations_ms: dict[int, int]
    friction_counts: dict[tuple[int, str], int]
    step_sequence: list[int] = field(default_factory=list)
    user_role: str = models.UserRole.employee.value
    account_age_days: float = 0.0


@dataclass(frozen=True)
class FeatureMatrix:
    values: np.ndarray
    feature_names: list[str]
    sessions: list[WalkthroughSessionData]


def _validate_cluster_settings(*, k: int, min_sessions: int) -> None:
    if not 2 <= k <= 4:
        raise ValueError("k must be between 2 and 4")
    if min_sessions < 1:
        raise ValueError("min_sessions must be at least 1")


def _feature_names(step_numbers: Sequence[int]) -> list[str]:
    names: list[str] = []
    for step_number in step_numbers:
        prefix = f"step_{step_number}"
        names.extend(
            [
                f"{prefix}_duration_ms",
                f"{prefix}_completed",
                f"{prefix}_in_order",
                f"{prefix}_first_visit_position",
                f"{prefix}_visit_count",
            ]
        )
        names.extend(f"{prefix}_friction_{event_type}" for event_type in FRICTION_TYPES)
    names.extend(
        [
            "total_duration_ms",
            "completion_ratio",
            "sequence_length",
            "backtrack_count",
            "skip_count",
            "role_employee",
            "role_reviewer",
            "role_manager",
            "account_age_days",
        ]
    )
    return names


def build_feature_matrix(
    sessions: Sequence[WalkthroughSessionData],
    step_numbers: Sequence[int],
) -> FeatureMatrix:
    """Build a stable, fixed-width feature matrix without database access."""
    ordered_steps = sorted(set(step_numbers))
    if not ordered_steps:
        raise ValueError("SOP must contain at least one numbered step")

    ordered_sessions = sorted(sessions, key=lambda item: str(item.session_id))
    rows: list[list[float]] = []
    step_indexes = {step_number: index for index, step_number in enumerate(ordered_steps)}
    for session in ordered_sessions:
        completed_steps = set(session.step_durations_ms)
        # Historical rows may contain stale/deleted step numbers. They have no
        # canonical position and must not affect any sequence-derived feature.
        sequence = [step for step in session.step_sequence if step in step_indexes]
        sequence_length = len(sequence)
        first_positions = (
            {
                step_number: (sequence.index(step_number) + 1) / sequence_length
                for step_number in set(sequence)
            }
            if sequence
            else {}
        )
        visit_counts = Counter(sequence)
        row: list[float] = []
        preceding_complete = True
        for step_number in ordered_steps:
            completed = step_number in completed_steps
            in_order = completed and preceding_complete
            row.extend(
                [
                    float(session.step_durations_ms.get(step_number, 0)),
                    float(completed),
                    float(in_order),
                    float(first_positions.get(step_number, 0)),
                    float(visit_counts.get(step_number, 0)),
                ]
            )
            row.extend(
                float(session.friction_counts.get((step_number, event_type), 0))
                for event_type in FRICTION_TYPES
            )
            preceding_complete = preceding_complete and completed
        row.extend(
            [
                float(session.total_duration_ms),
                len(completed_steps.intersection(ordered_steps)) / len(ordered_steps),
                float(sequence_length),
                float(
                    sum(
                        step_indexes[current] < step_indexes[previous]
                        for previous, current in zip(sequence, sequence[1:], strict=False)
                    )
                ),
                float(
                    sum(
                        step_indexes[current] - step_indexes[previous] - 1
                        for previous, current in zip(sequence, sequence[1:], strict=False)
                        if step_indexes[current] > step_indexes[previous]
                    )
                ),
                float(session.user_role == models.UserRole.employee.value),
                float(session.user_role == models.UserRole.reviewer.value),
                float(session.user_role == models.UserRole.manager.value),
                float(session.account_age_days),
            ]
        )
        rows.append(row)

    names = _feature_names(ordered_steps)
    matrix = np.asarray(rows, dtype=np.float64)
    if not rows:
        matrix = np.empty((0, len(names)), dtype=np.float64)
    return FeatureMatrix(values=matrix, feature_names=names, sessions=ordered_sessions)


def _sop_step_numbers(raw_steps: object) -> list[int]:
    if not isinstance(raw_steps, list):
        raise ValueError("SOP steps must be a list")
    numbers: list[int] = []
    for index, step in enumerate(raw_steps, start=1):
        raw_number = step.get("order", index) if isinstance(step, dict) else index
        try:
            number = int(raw_number)
        except (TypeError, ValueError) as exc:
            raise ValueError("SOP step order must be an integer") from exc
        if number < 1:
            raise ValueError("SOP step order must be positive")
        numbers.append(number)
    if len(numbers) != len(set(numbers)):
        raise ValueError("SOP step orders must be unique")
    return sorted(numbers)


def _user_role_value(raw_role: object) -> str:
    return raw_role.value if isinstance(raw_role, models.UserRole) else str(raw_role)


def _account_age_days(completed_at: datetime, created_at: datetime) -> float:
    if completed_at.tzinfo is None and created_at.tzinfo is not None:
        completed_at = completed_at.replace(tzinfo=created_at.tzinfo)
    elif completed_at.tzinfo is not None and created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=completed_at.tzinfo)
    return max(0.0, (completed_at - created_at).total_seconds() / 86_400)


def load_walkthrough_sessions(
    db: DBSession,
    *,
    tenant_id: UUID,
    workflow_id: UUID,
) -> tuple[list[WalkthroughSessionData], list[int]]:
    """Batch-load all eligible walkthrough data for one tenant-owned SOP."""
    sop = (
        db.query(models.Sop)
        .filter(models.Sop.id == workflow_id, models.Sop.tenant_id == tenant_id)
        .one_or_none()
    )
    if sop is None:
        raise AnalyticsSopNotFoundError("SOP not found")
    step_numbers = _sop_step_numbers(sop.steps)

    completions = (
        db.query(models.WalkthroughCompletion)
        .filter(
            models.WalkthroughCompletion.tenant_id == tenant_id,
            models.WalkthroughCompletion.sop_id == workflow_id,
        )
        .order_by(models.WalkthroughCompletion.id.asc())
        .all()
    )
    if not completions:
        return [], step_numbers

    completion_ids = [item.id for item in completions]
    employee_ids = sorted({item.employee_id for item in completions}, key=str)
    employees = (
        db.query(models.User)
        .filter(models.User.id.in_(employee_ids), models.User.tenant_id == tenant_id)
        .all()
    )
    users_by_id = {item.id: item for item in employees}

    timings = (
        db.query(models.WalkthroughStepTiming)
        .filter(models.WalkthroughStepTiming.completion_id.in_(completion_ids))
        .order_by(
            models.WalkthroughStepTiming.completion_id.asc(),
            models.WalkthroughStepTiming.step_number.asc(),
        )
        .all()
    )
    friction_events = (
        db.query(models.WalkthroughFrictionEvent)
        .filter(models.WalkthroughFrictionEvent.completion_id.in_(completion_ids))
        .order_by(
            models.WalkthroughFrictionEvent.completion_id.asc(),
            models.WalkthroughFrictionEvent.step_number.asc(),
            models.WalkthroughFrictionEvent.event_type.asc(),
        )
        .all()
    )

    durations_by_completion: dict[UUID, dict[int, int]] = {}
    for timing in timings:
        durations_by_completion.setdefault(timing.completion_id, {})[int(timing.step_number)] = int(
            timing.duration_ms
        )

    friction_by_completion: dict[UUID, Counter[tuple[int, str]]] = {}
    for event in friction_events:
        counts = friction_by_completion.setdefault(event.completion_id, Counter())
        counts[(int(event.step_number), str(event.event_type))] += 1

    return (
        [
            WalkthroughSessionData(
                session_id=item.id,
                employee_id=item.employee_id,
                total_duration_ms=int(item.duration_seconds) * 1000,
                step_durations_ms=durations_by_completion.get(item.id, {}),
                friction_counts=dict(friction_by_completion.get(item.id, {})),
                step_sequence=list(
                    getattr(item, "step_sequence", None)
                    or sorted(durations_by_completion.get(item.id, {}))
                ),
                user_role=_user_role_value(
                    getattr(item, "user_role", models.UserRole.employee.value)
                ),
                account_age_days=_account_age_days(
                    item.completed_at, users_by_id[item.employee_id].created_at
                ),
            )
            for item in completions
            if item.employee_id in users_by_id
        ],
        step_numbers,
    )


def _safe_silhouette(matrix: np.ndarray, labels: np.ndarray) -> float | None:
    unique_labels = np.unique(labels)
    if len(unique_labels) < 2 or len(unique_labels) >= len(matrix):
        return None
    try:
        return float(silhouette_score(matrix, labels, metric="euclidean"))
    except ValueError:
        return None


def _deviation_details(
    standardized_row: np.ndarray,
    standardized_center: np.ndarray,
    original_row: np.ndarray,
    original_center: np.ndarray,
    feature_names: Sequence[str],
) -> tuple[str, float, float, float, str]:
    standardized_deviations = standardized_row - standardized_center
    index = int(np.argmax(np.abs(standardized_deviations)))
    feature = feature_names[index]
    feature_value = float(original_row[index])
    centroid_value = float(original_center[index])
    deviation = feature_value - centroid_value
    direction = "above" if deviation >= 0 else "below"
    reason = (
        f"{feature} is {abs(float(standardized_deviations[index])):.3f} standard deviations "
        f"{direction} its cluster centroid"
    )
    return feature, feature_value, centroid_value, deviation, reason


def _cluster_characteristics(
    center: np.ndarray,
    feature_names: Sequence[str],
) -> list[str]:
    ranked = sorted(
        range(len(feature_names)),
        key=lambda index: (-abs(float(center[index])), feature_names[index]),
    )
    characteristics: list[str] = []
    for index in ranked[:3]:
        value = float(center[index])
        direction = "high" if value >= 0 else "low"
        characteristics.append(f"{direction} {feature_names[index]} ({abs(value):.3f} std)")
    return characteristics


def cluster_feature_matrix(
    features: FeatureMatrix,
    *,
    k: int = DEFAULT_CLUSTER_COUNT,
    min_sessions: int = DEFAULT_MIN_SESSIONS,
) -> tuple[
    list[AnalyticsCluster],
    list[AnalyticsAssignment],
    list[AnalyticsOutlier],
    float | None,
]:
    _validate_cluster_settings(k=k, min_sessions=min_sessions)
    session_count = len(features.sessions)
    required = max(min_sessions, k)
    if session_count < required:
        raise InsufficientAnalyticsDataError(
            f"Need at least {required} eligible walkthrough sessions; got {session_count}"
        )

    scaler = StandardScaler()
    standardized = scaler.fit_transform(features.values)
    distinct_pattern_count = len(np.unique(standardized, axis=0))
    if distinct_pattern_count < k:
        raise InsufficientAnalyticsDataError(
            f"Need at least {k} distinct execution patterns; got {distinct_pattern_count}"
        )
    model = KMeans(
        n_clusters=k,
        max_iter=100,
        random_state=42,
        n_init=10,
    )
    labels = model.fit_predict(standardized)
    centers = model.cluster_centers_
    original_centers = scaler.inverse_transform(centers)
    distances = np.linalg.norm(standardized - centers[labels], axis=1)
    threshold = float(np.mean(distances) + 2 * np.std(distances))
    score = _safe_silhouette(standardized, labels)

    assignments: list[AnalyticsAssignment] = []
    outliers: list[AnalyticsOutlier] = []
    for index, session in enumerate(features.sessions):
        cluster_id = int(labels[index])
        (
            deviating_feature,
            feature_value,
            centroid_value,
            deviation,
            reason,
        ) = _deviation_details(
            standardized[index],
            centers[cluster_id],
            features.values[index],
            original_centers[cluster_id],
            features.feature_names,
        )
        distance = float(distances[index])
        assignment = AnalyticsAssignment(
            session_id=str(session.session_id),
            employee_id=str(session.employee_id),
            cluster_id=cluster_id,
            distance_to_center=distance,
        )
        assignments.append(assignment)
        if distance > threshold:
            outliers.append(
                AnalyticsOutlier(
                    **assignment.model_dump(),
                    threshold=threshold,
                    deviating_feature=deviating_feature,
                    feature_value=feature_value,
                    centroid_value=centroid_value,
                    deviation=deviation,
                    reason=reason,
                )
            )

    clusters: list[AnalyticsCluster] = []
    for cluster_id in range(k):
        member_indexes = np.flatnonzero(labels == cluster_id).tolist()
        clusters.append(
            AnalyticsCluster(
                cluster_id=cluster_id,
                centroid_values={
                    name: float(original_centers[cluster_id, index])
                    for index, name in enumerate(features.feature_names)
                },
                size=len(member_indexes),
                member_session_ids=[
                    str(features.sessions[index].session_id) for index in member_indexes
                ],
                member_employee_ids=sorted(
                    {str(features.sessions[index].employee_id) for index in member_indexes}
                ),
                characteristics=_cluster_characteristics(
                    centers[cluster_id],
                    features.feature_names,
                ),
            )
        )
    return clusters, assignments, outliers, score


def cluster_walkthroughs(
    db: DBSession,
    *,
    tenant_id: UUID,
    workflow_id: UUID,
    k: int = DEFAULT_CLUSTER_COUNT,
    min_sessions: int = DEFAULT_MIN_SESSIONS,
) -> AnalyticsClusteringResponse:
    """Cluster walkthrough completions for a tenant-owned SOP UUID."""
    started = time.perf_counter()
    _validate_cluster_settings(k=k, min_sessions=min_sessions)
    sessions, step_numbers = load_walkthrough_sessions(
        db,
        tenant_id=tenant_id,
        workflow_id=workflow_id,
    )
    features = build_feature_matrix(sessions, step_numbers)
    clusters, assignments, outliers, score = cluster_feature_matrix(
        features,
        k=k,
        min_sessions=min_sessions,
    )
    elapsed_ms = int((time.perf_counter() - started) * 1000)
    return AnalyticsClusteringResponse(
        workflow_id=workflow_id,
        k=k,
        clusters=clusters,
        assignments=assignments,
        outliers=outliers,
        silhouette_score=score,
        metadata=AnalyticsClusteringMetadata(
            algorithm_version=ALGORITHM_VERSION,
            computed_at=datetime.now(UTC),
            computation_time_ms=elapsed_ms,
            cached=False,
            session_count=len(sessions),
            feature_count=len(features.feature_names),
            feature_names=features.feature_names,
        ),
    )


__all__ = [
    "ALGORITHM_VERSION",
    "AnalyticsSopNotFoundError",
    "DEFAULT_CLUSTER_COUNT",
    "DEFAULT_MIN_SESSIONS",
    "FeatureMatrix",
    "FRICTION_TYPES",
    "InsufficientAnalyticsDataError",
    "WalkthroughSessionData",
    "build_feature_matrix",
    "cluster_feature_matrix",
    "cluster_walkthroughs",
    "load_walkthrough_sessions",
]
