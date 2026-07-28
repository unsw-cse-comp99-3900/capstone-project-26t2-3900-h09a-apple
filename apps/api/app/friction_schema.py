from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class FrictionEmployeeStepResponse(BaseModel):
    employee_id: UUID
    employee_email: str | None = None
    completion_id: UUID
    step_number: int
    duration_ms: int
    expected_duration_ms: int
    retry_count: int
    path_deviation_count: int
    score: float = Field(..., ge=0, le=100)
    is_outlier: bool


class FrictionEmployeeSummary(BaseModel):
    employee_id: UUID
    employee_email: str | None = None
    average_score: float = Field(..., ge=0, le=100)
    highest_friction_step: int


class FrictionStepAggregateResponse(BaseModel):
    step_number: int
    step_title: str | None = None
    average_score: float = Field(..., ge=0, le=100)
    min_score: float = Field(..., ge=0, le=100)
    max_score: float = Field(..., ge=0, le=100)
    best_employee_id: UUID | None = None
    best_employee_email: str | None = None
    worst_employee_id: UUID | None = None
    worst_employee_email: str | None = None
    sample_size: int


class FrictionAnalysisResponse(BaseModel):
    analysis_id: UUID
    sop_id: UUID
    status: str
    overall_score: float | None = Field(default=None, ge=0, le=100)
    highest_friction_step: int | None = None
    employee_count: int
    algorithm_version: str
    error_message: str | None = None
    triggered_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
    steps: list[FrictionStepAggregateResponse] = Field(default_factory=list)
    employees: list[FrictionEmployeeSummary] = Field(default_factory=list)
    employee_step_scores: list[FrictionEmployeeStepResponse] = Field(default_factory=list)
