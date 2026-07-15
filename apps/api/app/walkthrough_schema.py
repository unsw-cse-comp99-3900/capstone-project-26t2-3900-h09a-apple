from __future__ import annotations

from datetime import datetime
from typing import Literal
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
    friction_events: list[FrictionEventPayload] = Field(default_factory=list)
    step_timings: list[StepTimingPayload] = Field(default_factory=list)


class WalkthroughCompletionResponse(BaseModel):
    completion_id: UUID