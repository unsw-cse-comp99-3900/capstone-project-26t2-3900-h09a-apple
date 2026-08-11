"""
Pydantic models for analytics clustering request and response bodies.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class AnalyticsCluster(BaseModel):
    cluster_id: int = Field(..., ge=0)
    size: int = Field(..., ge=0)
    centroid_values: dict[str, float]
    member_session_ids: list[str]
    member_employee_ids: list[str]
    characteristics: list[str]


class AnalyticsAssignment(BaseModel):
    session_id: str
    employee_id: str
    cluster_id: int = Field(..., ge=0)
    distance_to_center: float = Field(..., ge=0)


class AnalyticsOutlier(BaseModel):
    session_id: str
    employee_id: str
    cluster_id: int = Field(..., ge=0)
    distance_to_center: float = Field(..., ge=0)
    threshold: float = Field(..., ge=0)
    deviating_feature: str
    feature_value: float
    centroid_value: float
    deviation: float
    reason: str


class AnalyticsClusteringMetadata(BaseModel):
    session_count: int = Field(..., ge=0)
    feature_count: int = Field(..., ge=0)
    feature_names: list[str]
    algorithm_version: str
    computed_at: datetime
    computation_time_ms: int = Field(..., ge=0)
    cached: bool


class AnalyticsClusteringResponse(BaseModel):
    workflow_id: UUID
    k: int = Field(..., ge=2, le=4)
    clusters: list[AnalyticsCluster]
    assignments: list[AnalyticsAssignment]
    outliers: list[AnalyticsOutlier]
    silhouette_score: float | None
    metadata: AnalyticsClusteringMetadata


class AnalyticsClusteringRequest(BaseModel):
    workflow_id: UUID
    k: int = Field(default=3, ge=2, le=4)
    min_sessions: int = Field(default=5, ge=1)
