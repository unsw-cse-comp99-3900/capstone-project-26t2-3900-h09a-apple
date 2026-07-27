from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from sqlalchemy import func
from sqlalchemy.orm import Session as DBSession
from sqlalchemy.orm import aliased

from app.auth.deps import filter_by_tenant, require_role
from app.auth.jwt import InvalidTokenError, verify_token
from app.database import get_db
from app.feedback_classification import classify_feedback_transcript
from app.feedback_notify import notification_hub, notify_feedback_uploaded
from app.feedback_schema import (
    AudioUrlResponse,
    FeedbackNotificationItem,
    FeedbackNotificationListResponse,
    FeedbackStatsResponse,
    TranscribeResponse,
    VoiceFeedbackCreateResponse,
    VoiceFeedbackItem,
    VoiceFeedbackListResponse,
    VoiceFeedbackReviewRequest,
)
from app.feedback_storage import upload_feedback_audio
from app.feedback_transcription import transcribe_audio_bytes, transcribe_upload
from app.models import (
    FeedbackNotification,
    FeedbackReviewStatus,
    FeedbackSeverity,
    Sop,
    User,
    UserRole,
    VoiceFeedback,
)
from app.storage import ObjectStorage, get_storage

router = APIRouter(prefix="/api/v1/feedback", tags=["feedback"])
notifications_router = APIRouter(prefix="/api/v1/notifications", tags=["notifications"])

AUDIO_URL_EXPIRES = 60 * 60


def _serialize_feedback(
    row: VoiceFeedback,
    *,
    employee_email: str,
    sop_title: str,
    audio_url: str | None = None,
) -> VoiceFeedbackItem:
    tags = row.reviewer_tags if isinstance(row.reviewer_tags, list) else []
    return VoiceFeedbackItem(
        id=row.id,
        sop_id=row.sop_id,
        sop_title=sop_title,
        employee_id=row.employee_id,
        employee_email=employee_email,
        transcript=row.transcript,
        classification=row.classification,
        polarity=row.polarity,
        severity=row.severity,
        status=row.status,
        duration_seconds=float(row.duration_seconds),
        language=row.language,
        reviewer_comment=row.reviewer_comment,
        reviewer_tags=[str(tag) for tag in tags],
        reviewed_by=row.reviewed_by,
        reviewed_at=row.reviewed_at,
        recorded_at=row.recorded_at,
        created_at=row.created_at,
        audio_url=audio_url,
    )


def _joined_feedback_query(db: DBSession, current_user: User):
    employee = aliased(User)
    return (
        filter_by_tenant(
            db.query(VoiceFeedback, employee, Sop), VoiceFeedback, current_user.tenant_id
        )
        .join(employee, employee.id == VoiceFeedback.employee_id)
        .join(Sop, Sop.id == VoiceFeedback.sop_id)
    )


@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe_feedback(
    audio: Annotated[UploadFile, File()],
    current_user: Annotated[User, Depends(require_role(UserRole.employee))],
) -> TranscribeResponse:
    result = await transcribe_upload(audio)
    return TranscribeResponse(**result)


def _parse_optional_uuid(value: str | None) -> UUID | None:
    if value is None:
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    try:
        return UUID(cleaned)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid UUID: {cleaned}",
        ) from exc


def _parse_optional_datetime(value: str | None) -> datetime | None:
    if value is None:
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    try:
        return datetime.fromisoformat(cleaned.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid datetime: {cleaned}",
        ) from exc


@router.post("/voice", response_model=VoiceFeedbackCreateResponse, status_code=201)
async def upload_voice_feedback(
    audio: Annotated[UploadFile, File()],
    current_user: Annotated[User, Depends(require_role(UserRole.employee))],
    db: Annotated[DBSession, Depends(get_db)],
    storage: Annotated[ObjectStorage, Depends(get_storage)],
    sop_id: Annotated[str | None, Form()] = None,
    walkthrough_id: Annotated[str | None, Form()] = None,
    recorded_at: Annotated[str | None, Form()] = None,
) -> VoiceFeedbackCreateResponse:
    resolved_sop_id = _parse_optional_uuid(sop_id) or _parse_optional_uuid(walkthrough_id)
    recorded_at_value = _parse_optional_datetime(recorded_at)
    if resolved_sop_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="sop_id is required",
        )

    sop = (
        filter_by_tenant(db.query(Sop), Sop, current_user.tenant_id)
        .filter(Sop.id == resolved_sop_id)
        .first()
    )
    if sop is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="SOP not found")

    audio_bytes = await audio.read()
    suffix = (audio.filename or "audio.webm").rsplit(".", 1)
    file_suffix = f".{suffix[-1]}" if len(suffix) == 2 else ".webm"
    transcription = await transcribe_audio_bytes(audio_bytes, suffix=file_suffix)
    classification = classify_feedback_transcript(transcription["transcript"])
    feedback_id = uuid4()

    uploaded = upload_feedback_audio(
        storage,
        tenant_id=current_user.tenant_id,
        employee_id=current_user.id,
        sop_id=resolved_sop_id,
        feedback_id=feedback_id,
        body=audio_bytes,
        content_type=audio.content_type,
    )

    row = VoiceFeedback(
        id=feedback_id,
        tenant_id=current_user.tenant_id,
        employee_id=current_user.id,
        sop_id=resolved_sop_id,
        audio_object_key=uploaded.object_key,
        content_type=uploaded.content_type,
        duration_seconds=transcription["duration_seconds"],
        transcript=transcription["transcript"],
        language=transcription.get("language"),
        classification=classification.classification.value,
        polarity=classification.polarity.value,
        severity=classification.severity.value,
        status=FeedbackReviewStatus.pending.value,
        recorded_at=recorded_at_value or datetime.now(UTC),
    )
    db.add(row)
    db.flush()

    await notify_feedback_uploaded(
        db,
        feedback=row,
        employee_email=current_user.email,
        sop_title=sop.title,
    )
    db.commit()
    db.refresh(row)

    return VoiceFeedbackCreateResponse(
        feedback_id=row.id,
        transcript=row.transcript,
        classification=row.classification,
        polarity=row.polarity,
        severity=row.severity,
        duration_seconds=float(row.duration_seconds),
        language=row.language,
        status=row.status,
    )


@router.get("", response_model=VoiceFeedbackListResponse)
def list_voice_feedback(
    current_user: Annotated[User, Depends(require_role(UserRole.reviewer))],
    db: Annotated[DBSession, Depends(get_db)],
    storage: Annotated[ObjectStorage, Depends(get_storage)],
    severity: Annotated[str | None, Query()] = None,
    classification: Annotated[str | None, Query()] = None,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
    sop_id: Annotated[UUID | None, Query()] = None,
    include_audio_url: Annotated[bool, Query()] = False,
) -> VoiceFeedbackListResponse:
    query = _joined_feedback_query(db, current_user)
    if severity:
        query = query.filter(VoiceFeedback.severity == severity)
    if classification:
        query = query.filter(VoiceFeedback.classification == classification)
    if status_filter:
        query = query.filter(VoiceFeedback.status == status_filter)
    if sop_id:
        query = query.filter(VoiceFeedback.sop_id == sop_id)

    severity_rank = {
        FeedbackSeverity.high.value: 0,
        FeedbackSeverity.medium.value: 1,
        FeedbackSeverity.low.value: 2,
    }
    rows = query.order_by(VoiceFeedback.created_at.desc()).all()
    rows.sort(
        key=lambda item: (severity_rank.get(item[0].severity, 9), -item[0].created_at.timestamp())
    )

    feedbacks: list[VoiceFeedbackItem] = []
    for feedback, employee, sop in rows:
        audio_url = None
        if include_audio_url:
            audio_url = storage.generate_signed_url(
                feedback.audio_object_key,
                expires=AUDIO_URL_EXPIRES,
            )
        feedbacks.append(
            _serialize_feedback(
                feedback,
                employee_email=employee.email,
                sop_title=sop.title,
                audio_url=audio_url,
            )
        )
    return VoiceFeedbackListResponse(feedbacks=feedbacks)


@router.get("/stats", response_model=FeedbackStatsResponse)
def feedback_stats(
    current_user: Annotated[User, Depends(require_role(UserRole.manager))],
    db: Annotated[DBSession, Depends(get_db)],
) -> FeedbackStatsResponse:
    base = filter_by_tenant(db.query(VoiceFeedback), VoiceFeedback, current_user.tenant_id)
    total = base.count()

    by_classification = {
        key: count
        for key, count in (
            filter_by_tenant(
                db.query(VoiceFeedback.classification, func.count()),
                VoiceFeedback,
                current_user.tenant_id,
            )
            .group_by(VoiceFeedback.classification)
            .all()
        )
    }
    by_severity = {
        key: count
        for key, count in (
            filter_by_tenant(
                db.query(VoiceFeedback.severity, func.count()),
                VoiceFeedback,
                current_user.tenant_id,
            )
            .group_by(VoiceFeedback.severity)
            .all()
        )
    }
    by_status = {
        key: count
        for key, count in (
            filter_by_tenant(
                db.query(VoiceFeedback.status, func.count()), VoiceFeedback, current_user.tenant_id
            )
            .group_by(VoiceFeedback.status)
            .all()
        )
    }

    high_rows = (
        _joined_feedback_query(db, current_user)
        .filter(
            VoiceFeedback.severity == FeedbackSeverity.high.value,
            VoiceFeedback.status == FeedbackReviewStatus.pending.value,
        )
        .order_by(VoiceFeedback.created_at.desc())
        .limit(20)
        .all()
    )
    high_severity_open = [
        _serialize_feedback(feedback, employee_email=employee.email, sop_title=sop.title)
        for feedback, employee, sop in high_rows
    ]

    return FeedbackStatsResponse(
        total=total,
        by_classification=by_classification,
        by_severity=by_severity,
        by_status=by_status,
        high_severity_open=high_severity_open,
    )


@router.get("/{feedback_id}", response_model=VoiceFeedbackItem)
def get_voice_feedback(
    feedback_id: UUID,
    current_user: Annotated[User, Depends(require_role(UserRole.reviewer))],
    db: Annotated[DBSession, Depends(get_db)],
    storage: Annotated[ObjectStorage, Depends(get_storage)],
) -> VoiceFeedbackItem:
    row = _joined_feedback_query(db, current_user).filter(VoiceFeedback.id == feedback_id).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feedback not found")
    feedback, employee, sop = row
    return _serialize_feedback(
        feedback,
        employee_email=employee.email,
        sop_title=sop.title,
        audio_url=storage.generate_signed_url(feedback.audio_object_key, expires=AUDIO_URL_EXPIRES),
    )


@router.get("/{feedback_id}/audio-url", response_model=AudioUrlResponse)
def get_voice_feedback_audio_url(
    feedback_id: UUID,
    current_user: Annotated[User, Depends(require_role(UserRole.reviewer))],
    db: Annotated[DBSession, Depends(get_db)],
    storage: Annotated[ObjectStorage, Depends(get_storage)],
) -> AudioUrlResponse:
    feedback = (
        filter_by_tenant(db.query(VoiceFeedback), VoiceFeedback, current_user.tenant_id)
        .filter(VoiceFeedback.id == feedback_id)
        .first()
    )
    if feedback is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feedback not found")
    return AudioUrlResponse(
        url=storage.generate_signed_url(feedback.audio_object_key, expires=AUDIO_URL_EXPIRES),
        expires_in_seconds=AUDIO_URL_EXPIRES,
    )


@router.patch("/{feedback_id}/review", response_model=VoiceFeedbackItem)
def review_voice_feedback(
    feedback_id: UUID,
    payload: VoiceFeedbackReviewRequest,
    current_user: Annotated[User, Depends(require_role(UserRole.reviewer))],
    db: Annotated[DBSession, Depends(get_db)],
) -> VoiceFeedbackItem:
    row = _joined_feedback_query(db, current_user).filter(VoiceFeedback.id == feedback_id).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feedback not found")

    feedback, employee, sop = row
    clean_tags = [tag.strip() for tag in payload.tags if tag and tag.strip()][:20]
    feedback.reviewer_comment = payload.comment
    feedback.reviewer_tags = clean_tags
    feedback.updated_at = datetime.now(UTC)
    if payload.mark_reviewed:
        feedback.status = FeedbackReviewStatus.reviewed.value
        feedback.reviewed_by = current_user.id
        feedback.reviewed_at = datetime.now(UTC)
    db.commit()
    db.refresh(feedback)
    return _serialize_feedback(
        feedback,
        employee_email=employee.email,
        sop_title=sop.title,
    )


@notifications_router.get("", response_model=FeedbackNotificationListResponse)
def list_notifications(
    current_user: Annotated[User, Depends(require_role(UserRole.reviewer))],
    db: Annotated[DBSession, Depends(get_db)],
    unread_only: Annotated[bool, Query()] = False,
) -> FeedbackNotificationListResponse:
    query = (
        filter_by_tenant(
            db.query(FeedbackNotification), FeedbackNotification, current_user.tenant_id
        )
        .filter(FeedbackNotification.recipient_id == current_user.id)
        .order_by(FeedbackNotification.created_at.desc())
    )
    if unread_only:
        query = query.filter(FeedbackNotification.read_at.is_(None))
    rows = query.limit(100).all()
    return FeedbackNotificationListResponse(
        notifications=[
            FeedbackNotificationItem(
                id=row.id,
                feedback_id=row.feedback_id,
                event_type=row.event_type,
                title=row.title,
                body=row.body,
                delivered_via=row.delivered_via,
                read_at=row.read_at,
                created_at=row.created_at,
                review_path=f"/review?tab=feedback&feedbackId={row.feedback_id}",
            )
            for row in rows
        ]
    )


@notifications_router.post("/{notification_id}/read", response_model=FeedbackNotificationItem)
def mark_notification_read(
    notification_id: UUID,
    current_user: Annotated[User, Depends(require_role(UserRole.reviewer))],
    db: Annotated[DBSession, Depends(get_db)],
) -> FeedbackNotificationItem:
    row = (
        filter_by_tenant(
            db.query(FeedbackNotification), FeedbackNotification, current_user.tenant_id
        )
        .filter(
            FeedbackNotification.id == notification_id,
            FeedbackNotification.recipient_id == current_user.id,
        )
        .first()
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    if row.read_at is None:
        row.read_at = datetime.now(UTC)
        db.commit()
        db.refresh(row)
    return FeedbackNotificationItem(
        id=row.id,
        feedback_id=row.feedback_id,
        event_type=row.event_type,
        title=row.title,
        body=row.body,
        delivered_via=row.delivered_via,
        read_at=row.read_at,
        created_at=row.created_at,
        review_path=f"/review?tab=feedback&feedbackId={row.feedback_id}",
    )


@notifications_router.websocket("/ws")
async def notifications_ws(
    websocket: WebSocket,
    db: Annotated[DBSession, Depends(get_db)],
    token: Annotated[str | None, Query()] = None,
) -> None:
    if not token:
        await websocket.close(code=4401)
        return
    try:
        payload = verify_token(token)
        user_id = UUID(payload["user_id"])
    except (InvalidTokenError, ValueError, KeyError):
        await websocket.close(code=4401)
        return

    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        await websocket.close(code=4401)
        return
    try:
        role = UserRole(user.role)
    except ValueError:
        await websocket.close(code=4403)
        return
    if role not in {UserRole.reviewer, UserRole.manager}:
        await websocket.close(code=4403)
        return

    await notification_hub.connect(user.id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await notification_hub.disconnect(user.id, websocket)
