"""
Pydantic schemas for walkthrough completion and vision locate.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, Field

from app.models import WalkthroughFrictionType


class FrictionEventPayload(BaseModel):
    step_number: int = Field(..., ge=1)
    event_type: WalkthroughFrictionType
    occurred_at: datetime


class StepTimingPayload(BaseModel):
    step_number: int = Field(..., ge=1)
    duration_ms: int = Field(..., ge=0)


class WalkthroughCompletionPayload(BaseModel):
    model_config = {
        "json_schema_extra": {
            "example": {
                "sop_id": "6d1c3a59-9d0c-4fd5-8c8b-26dc0d57d62a",
                "completed_at": "2026-07-15T10:25:31Z",
                "duration_seconds": 142,
                "step_sequence": [1, 2, 1, 2, 3],
                "friction_events": [
                    {
                        "step_number": 2,
                        "event_type": "selector_miss",
                        "occurred_at": "2026-07-15T10:24:02Z",
                    }
                ],
                "step_timings": [
                    {
                        "step_number": 1,
                        "duration_ms": 3200,
                    },
                    {
                        "step_number": 2,
                        "duration_ms": 6100,
                    },
                ],
            }
        }
    }
    sop_id: UUID
    completed_at: datetime
    duration_seconds: int = Field(..., ge=0)
    step_sequence: list[Annotated[int, Field(ge=1)]] = Field(
        default_factory=list,
        max_length=10_000,
    )
    friction_events: list[FrictionEventPayload] = Field(default_factory=list)
    step_timings: list[StepTimingPayload] = Field(default_factory=list)


class WalkthroughCompletionResponse(BaseModel):
    completion_id: UUID


class WalkthroughLocateRequest(BaseModel):
    """Viewport screenshot + element description for vision grid locate."""

    image_base64: str = Field(..., min_length=32, max_length=8_000_000)
    content_type: str = Field(default="image/jpeg", max_length=64)
    description: str = Field(..., min_length=1, max_length=500)
    instruction: str | None = Field(default=None, max_length=2000)
    viewport_width: int = Field(..., ge=1, le=10_000)
    viewport_height: int = Field(..., ge=1, le=10_000)
    step_number: int | None = Field(default=None, ge=1)


class WalkthroughLocateResponse(BaseModel):
    x: float
    y: float
    width: float
    height: float
    image_width: int
    image_height: int
    viewport_width: int
    viewport_height: int
    coarse_cell: str
    fine_cell: str
    method: str = "vision_grid_2stage"
