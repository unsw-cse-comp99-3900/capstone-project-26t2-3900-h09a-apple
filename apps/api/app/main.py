import os
from uuid import UUID

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DBSession

from app import models
from app.database import get_db
from app.ingestion import ingest_session
from app.mock_sop_generator import MockSopGenerator
from app.session_schema import SessionPayload
from app.sop_schema import (
    SopDetailPayload,
    SopPayload,
    SopStepResponse,
    SopWarning,
)
from app.sop_service import resolve_step_screenshot_url
from app.storage import ObjectStorage, get_storage

load_dotenv()

app = FastAPI(title="H09A Apple API")

cors_origins = [o.strip() for o in os.getenv("API_CORS_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins or ["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/v1/sessions", status_code=status.HTTP_201_CREATED)
def create_session(
    payload: SessionPayload,
    db: DBSession = Depends(get_db),
    storage: ObjectStorage = Depends(get_storage),
) -> dict[str, str]:
    try:
        ingested_session = ingest_session(payload, db, storage if payload.screenshots else None)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Session with this client_session_id already exists",
        ) from exc
    except Exception:
        db.rollback()
        raise

    return {
        "session_id": ingested_session.session_id,
        "job_id": ingested_session.job_id,
    }


@app.post(
    "/api/v1/sessions/{session_id}/generate-sop",
    response_model=SopPayload,
    status_code=status.HTTP_201_CREATED,
)
def generate_sop(
    session_id: UUID,
    db: DBSession = Depends(get_db),
):
    # find session
    session = db.query(models.Session).filter(models.Session.id == session_id).first()

    if session is None:
        raise HTTPException(
            status_code=404,
            detail="Session not found",
        )

    # prevent duplicate SOP generation
    existing = db.query(models.Sop).filter(models.Sop.session_id == session_id).first()

    if existing:
        raise HTTPException(
            status_code=409,
            detail="SOP already generated",
        )
    try:
        generator = MockSopGenerator()
        payload = generator.generate(session)

        sop = models.Sop(
            session_id=session.id,
            title=payload.title,
            steps=[step.model_dump() for step in payload.steps],
            warnings=[warning.model_dump() for warning in payload.warnings],
        )
        db.add(sop)

        # update job status
        job = (
            db.query(models.CodificationJob)
            .filter(
                models.CodificationJob.session_id == session.id,
                models.CodificationJob.status == models.CodificationJobStatus.pending.value,
            )
            .first()
        )

        if job:
            job.status = models.CodificationJobStatus.completed.value

        db.commit()

        return payload
    except Exception:
        db.rollback()

        job = (
            db.query(models.CodificationJob)
            .filter(
                models.CodificationJob.session_id == session.id,
                models.CodificationJob.status == models.CodificationJobStatus.pending.value,
            )
            .first()
        )

        if job:
            job.status = models.CodificationJobStatus.failed.value
            db.commit()

        raise


@app.get(
    "/api/v1/sops/{sop_id}",
    response_model=SopDetailPayload,
)
def get_sop(
    sop_id: UUID,
    db: DBSession = Depends(get_db),
    storage: ObjectStorage = Depends(get_storage),
):
    sop = (
        db.query(models.Sop)
        .filter(models.Sop.id == sop_id)
        .first()
    )

    if sop is None:
        raise HTTPException(status_code=404, detail="SOP not found")

    steps = [
        SopStepResponse(
            **step,
            screenshot_url=resolve_step_screenshot_url(
                step["source_event_ids"],
                db,
                storage,
            ),
        )
        for step in sop.steps
    ]

    warnings = [
        SopWarning.model_validate(warning)
        for warning in sop.warnings
    ]

    return SopDetailPayload(
        id=str(sop.id),
        title=sop.title,
        # 临时方案，需确认
        summary=f"{len(steps)} step workflow",
        version=sop.version,
        generated_at=sop.generated_at,
        steps=steps,
        warnings=warnings,
    )