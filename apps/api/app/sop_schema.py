from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class SopStep(BaseModel):
    order: int = Field(..., ge=1)
    title: str = Field(..., min_length=1)
    instruction: str = Field(..., min_length=1)
    branch: str | None = None
    source_event_ids: list[str] = Field(default_factory=list)


class SopStepResponse(SopStep):
    screenshot_url: str | None = None


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

    steps: list[SopStepResponse]
    warnings: list[SopWarning] = Field(default_factory=list)


class SopPublishResponse(BaseModel):
    id: str
    status: str
    published_at: datetime
    library_url: str


class SopLibraryItem(BaseModel):
    id: str
    title: str
    workflow_category: str | None = None
    step_count: int
    published_at: datetime | None = None


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
    screenshot_url: str | None = None


class WalkthroughPayload(BaseModel):
    steps: list[WalkthroughStep] = Field(..., min_length=1)
