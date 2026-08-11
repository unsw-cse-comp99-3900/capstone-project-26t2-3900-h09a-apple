"""
Pydantic schemas for consent accept and status responses.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models import ConsentType


class ConsentAcceptRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    consent_type: ConsentType
    version: str = Field(min_length=1, max_length=64)


class ConsentAcceptResponse(BaseModel):
    consent_type: ConsentType
    version: str
    accepted_at: datetime


class ConsentStatusResponse(BaseModel):
    accepted: bool
    accepted_at: datetime | None = None
    consent_type: ConsentType
    version: str
