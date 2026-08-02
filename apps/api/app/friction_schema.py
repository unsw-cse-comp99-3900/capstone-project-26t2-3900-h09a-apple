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


class FrictionWsTicketResponse(BaseModel):
    ticket: str
    expires_in_seconds: int
    ws_path: str = "/api/v1/analytics/friction/ws"


class FrictionStepChartPoint(BaseModel):
    """PII-free step score point for manager list/detail charts."""

    step_number: int = Field(..., ge=1)
    step_title: str | None = None
    instruction: str | None = None
    average_score: float = Field(..., ge=0, le=100)
    variance_flag: bool = False


class FrictionWorkflowSummary(BaseModel):
    """One ranked workflow card for the variance dashboard list (H09AAPPLE-38)."""

    workflow_id: UUID
    title: str
    status: str | None = None
    overall_score: float | None = Field(default=None, ge=0, le=100)
    session_count: int = Field(default=0, ge=0)
    high_variance: bool = False
    highest_friction_step: int | None = None
    insight_teaser: str | None = None
    insight_status: str = "pending"
    steps: list[FrictionStepChartPoint] = Field(default_factory=list)


class FrictionWorkflowListResponse(BaseModel):
    workflows: list[FrictionWorkflowSummary] = Field(default_factory=list)


class WorkflowInsightSummaryResponse(BaseModel):
    workflow_id: UUID
    status: str
    summary: str | None = None
    teaser: str | None = None


class FrictionRecalculateResponse(BaseModel):
    """Result of an on-demand manager friction recalculation (H09AAPPLE-39)."""

    workflow_id: UUID
    analysis_id: UUID
    status: str
    overall_score: float | None = Field(default=None, ge=0, le=100)
    employee_count: int = Field(default=0, ge=0)
