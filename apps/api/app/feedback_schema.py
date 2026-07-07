from __future__ import annotations

from pydantic import BaseModel, Field


class TranscribeResponse(BaseModel):
    transcript: str
    duration_seconds: float = Field(ge=0)
    language: str | None = None