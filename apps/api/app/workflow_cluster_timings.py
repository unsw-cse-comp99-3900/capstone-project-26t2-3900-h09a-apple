"""Per-cluster mean step timings for the variance drill-down (H09AAPPLE-39)."""

from __future__ import annotations

from collections import defaultdict
from uuid import UUID

from sqlalchemy.orm import Session as DBSession

from app import models
from app.workflow_cluster_schema import (
    ClusterStepTiming,
    ClusterTimingsCluster,
    WorkflowClusterTimingsResponse,
)


def _parse_session_ids(raw: object) -> list[UUID]:
    if not isinstance(raw, list):
        return []
    ids: list[UUID] = []
    for value in raw:
        try:
            ids.append(UUID(str(value)))
        except (TypeError, ValueError):
            continue
    return ids


def _mean_ms(values: list[int]) -> float:
    if not values:
        return 0.0
    return float(sum(values) / len(values))


def _step_means(durations_by_step: dict[int, list[int]]) -> list[ClusterStepTiming]:
    return [
        ClusterStepTiming(
            step_number=step_number,
            mean_duration_ms=round(_mean_ms(durations), 2),
        )
        for step_number, durations in sorted(durations_by_step.items())
        if durations
    ]


def _total_mean(steps: list[ClusterStepTiming]) -> float:
    return sum(step.mean_duration_ms for step in steps)


def build_cluster_timings_response(
    *,
    workflow_id: UUID,
    workflow_name: str,
    clusters: list[models.WorkflowCluster],
    sops: list[models.Sop],
    completions: list[models.WalkthroughCompletion],
    timings: list[models.WalkthroughStepTiming],
) -> WorkflowClusterTimingsResponse:
    """Aggregate preloaded rows into PII-free cluster timing means."""
    session_to_cluster: dict[UUID, int] = {}
    for cluster in clusters:
        for session_id in _parse_session_ids(cluster.member_session_ids):
            session_to_cluster[session_id] = int(cluster.cluster_id)

    sop_to_cluster: dict[UUID, int] = {}
    for sop in sops:
        cluster_id = session_to_cluster.get(sop.session_id)
        if cluster_id is not None:
            sop_to_cluster[sop.id] = cluster_id

    completion_to_cluster: dict[UUID, int] = {}
    for completion in completions:
        cluster_id = sop_to_cluster.get(completion.sop_id)
        if cluster_id is not None:
            completion_to_cluster[completion.id] = cluster_id

    cluster_durations: dict[int, dict[int, list[int]]] = defaultdict(lambda: defaultdict(list))
    workflow_durations: dict[int, list[int]] = defaultdict(list)

    for timing in timings:
        cluster_id = completion_to_cluster.get(timing.completion_id)
        if cluster_id is None:
            continue
        step_number = int(timing.step_number)
        duration_ms = int(timing.duration_ms)
        cluster_durations[cluster_id][step_number].append(duration_ms)
        workflow_durations[step_number].append(duration_ms)

    cluster_payloads: list[ClusterTimingsCluster] = []
    for cluster in sorted(clusters, key=lambda row: int(row.cluster_id)):
        cluster_id = int(cluster.cluster_id)
        steps = _step_means(cluster_durations.get(cluster_id, {}))
        member_count = len(_parse_session_ids(cluster.member_session_ids))
        cluster_payloads.append(
            ClusterTimingsCluster(
                cluster_id=cluster_id,
                member_count=member_count,
                steps=steps,
            )
        )

    best_cluster_id: int | None = None
    best_total: float | None = None
    for payload in cluster_payloads:
        if not payload.steps:
            continue
        total = _total_mean(payload.steps)
        if best_total is None or total < best_total:
            best_total = total
            best_cluster_id = payload.cluster_id

    return WorkflowClusterTimingsResponse(
        workflow_id=workflow_id,
        workflow_name=workflow_name,
        best_cluster_id=best_cluster_id,
        clusters=cluster_payloads,
        workflow_average=_step_means(workflow_durations),
    )


def load_workflow_cluster_timings(
    db: DBSession,
    *,
    tenant_id: UUID,
    sop_id: UUID,
) -> WorkflowClusterTimingsResponse | None:
    """Resolve SOP → workflow_name → clusters → mean step timings.

    Returns ``None`` when the SOP is missing for the tenant.
    """
    sop = (
        db.query(models.Sop)
        .filter(models.Sop.id == sop_id, models.Sop.tenant_id == tenant_id)
        .one_or_none()
    )
    if sop is None:
        return None

    session = (
        db.query(models.Session)
        .filter(
            models.Session.id == sop.session_id,
            models.Session.tenant_id == tenant_id,
        )
        .one_or_none()
    )
    workflow_name = session.workflow_name if session is not None else ""

    clusters = (
        db.query(models.WorkflowCluster)
        .filter(
            models.WorkflowCluster.tenant_id == tenant_id,
            models.WorkflowCluster.workflow_name == workflow_name,
        )
        .order_by(models.WorkflowCluster.cluster_id.asc())
        .all()
    )
    if not clusters or not workflow_name:
        return WorkflowClusterTimingsResponse(
            workflow_id=sop.id,
            workflow_name=workflow_name,
            best_cluster_id=None,
            clusters=[],
            workflow_average=[],
        )

    member_session_ids: list[UUID] = []
    for cluster in clusters:
        member_session_ids.extend(_parse_session_ids(cluster.member_session_ids))
    member_session_ids = list(dict.fromkeys(member_session_ids))

    if not member_session_ids:
        return build_cluster_timings_response(
            workflow_id=sop.id,
            workflow_name=workflow_name,
            clusters=clusters,
            sops=[],
            completions=[],
            timings=[],
        )

    sops = (
        db.query(models.Sop)
        .filter(
            models.Sop.tenant_id == tenant_id,
            models.Sop.session_id.in_(member_session_ids),
            models.Sop.status == models.SopStatus.published.value,
        )
        .all()
    )
    sop_ids = [row.id for row in sops]
    if not sop_ids:
        return build_cluster_timings_response(
            workflow_id=sop.id,
            workflow_name=workflow_name,
            clusters=clusters,
            sops=[],
            completions=[],
            timings=[],
        )

    completions = (
        db.query(models.WalkthroughCompletion)
        .filter(
            models.WalkthroughCompletion.tenant_id == tenant_id,
            models.WalkthroughCompletion.sop_id.in_(sop_ids),
        )
        .all()
    )
    completion_ids = [row.id for row in completions]
    timings: list[models.WalkthroughStepTiming] = []
    if completion_ids:
        timings = (
            db.query(models.WalkthroughStepTiming)
            .filter(models.WalkthroughStepTiming.completion_id.in_(completion_ids))
            .all()
        )

    return build_cluster_timings_response(
        workflow_id=sop.id,
        workflow_name=workflow_name,
        clusters=clusters,
        sops=sops,
        completions=completions,
        timings=timings,
    )


__all__ = ["build_cluster_timings_response", "load_workflow_cluster_timings"]
