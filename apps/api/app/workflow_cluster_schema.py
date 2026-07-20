from __future__ import annotations

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
