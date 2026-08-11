"""
Object-storage keys and heuristic classification helpers for feedback.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from app.models import FeedbackClassification, FeedbackPolarity, FeedbackSeverity
from app.storage import ObjectStorage

AUDIO_CONTENT_TYPE_EXTENSIONS = {
    "audio/webm": "webm",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/ogg": "ogg",
}


def normalize_audio_content_type(content_type: str | None) -> str:
    raw = (content_type or "audio/webm").split(";")[0].strip().lower()
    if raw not in AUDIO_CONTENT_TYPE_EXTENSIONS:
        return "audio/webm"
    return raw


def build_feedback_audio_object_key(
    *,
    tenant_id: UUID,
    employee_id: UUID,
    sop_id: UUID,
    feedback_id: UUID,
    content_type: str,
) -> str:
    extension = AUDIO_CONTENT_TYPE_EXTENSIONS[normalize_audio_content_type(content_type)]
    return (
        f"tenants/{tenant_id}/employees/{employee_id}/sops/{sop_id}/"
        f"feedback/{feedback_id}.{extension}"
    )


@dataclass(frozen=True)
class UploadedFeedbackAudio:
    object_key: str
    bytes: int
    content_type: str


def upload_feedback_audio(
    storage: ObjectStorage,
    *,
    tenant_id: UUID,
    employee_id: UUID,
    sop_id: UUID,
    feedback_id: UUID,
    body: bytes,
    content_type: str | None,
) -> UploadedFeedbackAudio:
    normalized = normalize_audio_content_type(content_type)
    object_key = build_feedback_audio_object_key(
        tenant_id=tenant_id,
        employee_id=employee_id,
        sop_id=sop_id,
        feedback_id=feedback_id,
        content_type=normalized,
    )
    storage.put_object(key=object_key, body=body, content_type=normalized)
    return UploadedFeedbackAudio(
        object_key=object_key,
        bytes=len(body),
        content_type=normalized,
    )


@dataclass(frozen=True)
class ClassificationResult:
    classification: FeedbackClassification
    polarity: FeedbackPolarity
    severity: FeedbackSeverity


def classify_feedback_heuristic(transcript: str) -> ClassificationResult:
    text = transcript.strip().lower()
    if any(
        token in text
        for token in (
            "broken",
            "bug",
            "error",
            "fail",
            "stuck",
            "cannot",
            "can't",
            "blocked",
            "wrong",
        )
    ):
        return ClassificationResult(
            classification=FeedbackClassification.friction,
            polarity=FeedbackPolarity.issue,
            severity=FeedbackSeverity.high,
        )
    if "?" in transcript or any(
        token in text for token in ("how do", "why ", "what ", "where ", "when ")
    ):
        return ClassificationResult(
            classification=FeedbackClassification.question,
            polarity=FeedbackPolarity.issue,
            severity=FeedbackSeverity.medium,
        )
    if any(
        token in text for token in ("suggest", "should", "could", "better", "improve", "recommend")
    ):
        return ClassificationResult(
            classification=FeedbackClassification.suggestion,
            polarity=FeedbackPolarity.issue,
            severity=FeedbackSeverity.low,
        )
    if any(token in text for token in ("great", "love", "helpful", "works well", "thanks")):
        return ClassificationResult(
            classification=FeedbackClassification.suggestion,
            polarity=FeedbackPolarity.positive,
            severity=FeedbackSeverity.low,
        )
    return ClassificationResult(
        classification=FeedbackClassification.suggestion,
        polarity=FeedbackPolarity.issue,
        severity=FeedbackSeverity.medium,
    )
