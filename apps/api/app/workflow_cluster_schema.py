"""
Pydantic schemas for workflow embedding-cluster API responses.
"""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field


class ClusterSessionAssignment(BaseModel):
    session_id: str
    sop_id: str
    cluster_id: int = Field(..., ge=0)
    distance_to_centroid: float = Field(..., ge=0)
    is_high_variance: bool


class StepVarianceItem(BaseModel):
    step_number: int = Field(..., ge=1)
    semantic_variance: float = Field(..., ge=0)


class WorkflowClusterResponse(BaseModel):
    workflow_id: str
    workflow_name: str
    run_id: str
    chosen_k: int = Field(..., ge=2, le=4)
    chosen_silhouette: float
    silhouette_scores: dict[str, float]
    high_variance_threshold: float
    session_count: int = Field(..., ge=0)
    assignments: list[ClusterSessionAssignment]
    step_variance: list[StepVarianceItem]
    elapsed_ms: int = Field(..., ge=0)


class ClusterStepTiming(BaseModel):
    """Mean duration for one step within a cluster or the workflow average."""

    step_number: int = Field(..., ge=1)
    mean_duration_ms: float = Field(..., ge=0)


class ClusterTimingsCluster(BaseModel):
    cluster_id: int = Field(..., ge=0)
    member_count: int = Field(..., ge=0)
    steps: list[ClusterStepTiming] = Field(default_factory=list)


class WorkflowClusterTimingsResponse(BaseModel):
    """PII-free per-cluster step timing aggregates for path comparison charts."""

    workflow_id: UUID
    workflow_name: str
    best_cluster_id: int | None = None
    clusters: list[ClusterTimingsCluster] = Field(default_factory=list)
    workflow_average: list[ClusterStepTiming] = Field(default_factory=list)
