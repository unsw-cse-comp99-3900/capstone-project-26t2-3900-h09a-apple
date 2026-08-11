"""
Pydantic schemas for SOP list, detail, approve, and publish APIs.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class SopStep(BaseModel):
    order: int = Field(..., ge=1)
    title: str = Field(..., min_length=1)
    instruction: str = Field(..., min_length=1)
    branch: str | None = None
    source_event_ids: list[str] = Field(default_factory=list)
    time_estimate: int | None = Field(default=None, ge=0)


class ScreenshotHighlight(BaseModel):
    x: float = Field(..., ge=0)
    y: float = Field(..., ge=0)
    width: float = Field(..., gt=0)
    height: float = Field(..., gt=0)
    viewport_width: float = Field(..., gt=0)
    viewport_height: float = Field(..., gt=0)


class SopStepResponse(SopStep):
    screenshot_url: str | None = None
    screenshot_highlight: ScreenshotHighlight | None = None


class SopWarning(BaseModel):
    type: Literal["repeated_action", "invalid_sequence", "missing_context"]
    message: str = Field(..., min_length=1)
    source_event_ids: list[str] = Field(default_factory=list)


class SopPayload(BaseModel):
    title: str = Field(..., min_length=1)
    summary: str = Field(..., min_length=1)
    steps: list[SopStep] = Field(..., min_length=1)
    warnings: list[SopWarning] = Field(default_factory=list)
    generation_mode: Literal["llm", "fallback"] = "llm"


class SopDetailPayload(BaseModel):
    id: str
    title: str
    summary: str
    version: int
    generated_at: datetime
    status: str

    steps: list[SopStepResponse]
    warnings: list[SopWarning] = Field(default_factory=list)


class SopPublishResponse(BaseModel):
    id: str
    status: str
    published_at: datetime
    library_url: str
    embedding_status: str | None = None
    friction_analysis_id: str
    friction_status: str


class SopEmbedResponse(BaseModel):
    id: str
    job_id: str
    embedding_status: str


class SopLibraryItem(BaseModel):
    id: str
    title: str
    workflow_category: str | None = None
    step_count: int
    published_at: datetime | None = None
    status: str


class SopListResponse(BaseModel):
    sops: list[SopLibraryItem]


class SopApproveResponse(BaseModel):
    id: str
    status: str


class WalkthroughStep(BaseModel):
    step_number: int = Field(..., ge=1)
    instruction: str = Field(..., min_length=1)
    css_selector: str | None = None
    xpath: str | None = None
    target_label: str | None = None
    aria_label: str | None = None
    role: str | None = None
    screenshot_url: str | None = None
    time_estimate: int | None = Field(default=None, ge=0)
    screenshot_highlight: ScreenshotHighlight | None = None
    # element: has css/xpath/aria_label; screenshot: no selector but has image; none: instruction-only.
    anchor_mode: Literal["element", "screenshot", "none"] = "element"
    expected_action: Literal["click", "input", "submit"] | None = None
    expected_url: str | None = None
    # Joined SopWarning messages for this step (via source_event_ids). Compact for the ball UI.
    warning: str | None = None


class WalkthroughPayload(BaseModel):
    steps: list[WalkthroughStep] = Field(..., min_length=1)
