from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, File, UploadFile

from app.auth.deps import require_role
from app.feedback_schema import TranscribeResponse
from app.feedback_transcription import transcribe_upload
from app.models import User, UserRole

router = APIRouter(prefix="/api/v1/feedback", tags=["feedback"])


@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe_feedback(
    audio: Annotated[UploadFile, File()],
    current_user: Annotated[User, Depends(require_role(UserRole.employee))],
) -> TranscribeResponse:
    result = await transcribe_upload(audio)
    return TranscribeResponse(**result)
