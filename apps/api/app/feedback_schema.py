from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class TranscribeResponse(BaseModel):
    transcript: str
    duration_seconds: float = Field(ge=0)
    language: str | None = None


class VoiceFeedbackCreateResponse(BaseModel):
    feedback_id: UUID
    transcript: str
    classification: str
    polarity: str
    severity: str
    duration_seconds: float = Field(ge=0)
    language: str | None = None
    status: str


class VoiceFeedbackItem(BaseModel):
    id: UUID
    sop_id: UUID
    sop_title: str
    employee_id: UUID
    employee_email: str
    transcript: str
    classification: str
    polarity: str
    severity: str
    status: str
    duration_seconds: float
    language: str | None = None
    reviewer_comment: str | None = None
    reviewer_tags: list[str] = Field(default_factory=list)
    reviewed_by: UUID | None = None
    reviewed_at: datetime | None = None
    recorded_at: datetime
    created_at: datetime
    audio_url: str | None = None


class VoiceFeedbackListResponse(BaseModel):
    feedbacks: list[VoiceFeedbackItem]


class VoiceFeedbackReviewRequest(BaseModel):
    comment: str | None = Field(default=None, max_length=4000)
    tags: list[str] = Field(default_factory=list, max_length=20)
    mark_reviewed: bool = True


class FeedbackStatsResponse(BaseModel):
    total: int
    by_classification: dict[str, int]
    by_severity: dict[str, int]
    by_status: dict[str, int]
    high_severity_open: list[VoiceFeedbackItem]


class FeedbackNotificationItem(BaseModel):
    id: UUID
    feedback_id: UUID
    event_type: str
    title: str
    body: str
    delivered_via: str
    read_at: datetime | None = None
    created_at: datetime
    review_path: str


class FeedbackNotificationListResponse(BaseModel):
    notifications: list[FeedbackNotificationItem]


class AudioUrlResponse(BaseModel):
    url: str
    expires_in_seconds: int = 3600


class NotificationWsTicketResponse(BaseModel):
    ticket: str
    expires_in_seconds: int = 60
    ws_path: str = "/api/v1/notifications/ws"
