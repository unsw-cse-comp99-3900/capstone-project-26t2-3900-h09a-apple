from typing import Literal

from pydantic import BaseModel, Field


class SopStep(BaseModel):
    order: int = Field(..., ge=1)
    title: str = Field(..., min_length=1)
    instruction: str = Field(..., min_length=1)
    source_event_ids: list[str] = Field(default_factory=list)


class SopWarning(BaseModel):
    type: Literal["repeated_action", "invalid_sequence", "missing_context"]
    message: str = Field(..., min_length=1)
    source_event_ids: list[str] = Field(default_factory=list)


class SopPayload(BaseModel):
    title: str = Field(..., min_length=1)
    summary: str = Field(..., min_length=1)
    steps: list[SopStep] = Field(..., min_length=1)
    warnings: list[SopWarning] = Field(default_factory=list)
