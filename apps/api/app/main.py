import os
import time
from uuid import UUID

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DBSession

from app import models
from app.auth.routes import router as auth_router
from app.database import get_db
from app.ingestion import ingest_session
from app.session_schema import (
    SessionPayload,
    SessionStatusResponse,
)
from app.sop_generator_selector import get_sop_generator
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

app.include_router(auth_router)


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


@app.get(
    "/api/v1/sessions/{session_id}",
    response_model=SessionStatusResponse,
)
def get_session_status(
    session_id: UUID,
    db: DBSession = Depends(get_db),
):
    session = db.query(models.Session).filter(models.Session.id == session_id).first()

    if session is None:
        raise HTTPException(
            status_code=404,
            detail="Session not found",
        )

    job = (
        db.query(models.CodificationJob)
        .filter(models.CodificationJob.session_id == session.id)
        .order_by(models.CodificationJob.created_at.desc())
        .first()
    )

    if job is None:
        raise HTTPException(
            status_code=404,
            detail="Codification job not found",
        )

    sop = (
        db.query(models.Sop)
        .filter(models.Sop.session_id == session.id)
        .order_by(models.Sop.generated_at.desc())
        .first()
    )

    sop_id = (
        sop.id
        if job.status == models.CodificationJobStatus.completed.value and sop is not None
        else None
    )

    return SessionStatusResponse(
        session_id=session.id,
        workflow_name=session.workflow_name,
        job_status=job.status,
        sop_id=sop_id,
    )


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
        generator = get_sop_generator(db=db)

        started = time.perf_counter()
        payload = generator.generate(session)
        gen_duration_ms = int((time.perf_counter() - started) * 1000)
        sop = models.Sop(
            session_id=session.id,
            title=payload.title,
            steps=[step.model_dump() for step in payload.steps],
            warnings=[warning.model_dump() for warning in payload.warnings],
            generation_mode=payload.generation_mode,
            gen_duration_ms=gen_duration_ms,
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
):
    sop = db.query(models.Sop).filter(models.Sop.id == sop_id).first()

    if sop is None:
        raise HTTPException(status_code=404, detail="SOP not found")

    steps = [
        SopStepResponse(
            **step,
            screenshot_url=resolve_step_screenshot_url(
                step["source_event_ids"],
                db,
            ),
        )
        for step in sop.steps
    ]

    warnings = [SopWarning.model_validate(warning) for warning in sop.warnings]

    return SopDetailPayload(
        id=str(sop.id),
        title=sop.title,
        # Mock generator summary is deterministic and not stored in the database.
        # TODO: Persist summary in the SOP model if it becomes part of the stored contract.
        summary=f"{len(steps)} step workflow",
        version=sop.version,
        generated_at=sop.generated_at,
        steps=steps,
        warnings=warnings,
    )
