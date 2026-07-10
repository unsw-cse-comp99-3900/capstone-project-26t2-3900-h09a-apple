import os
import time
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from uuid import UUID

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DBSession

from app import models
from app.auth.deps import filter_by_tenant, require_role
from app.auth.routes import router as auth_router
from app.database import get_db
from app.feedback_routes import router as feedback_router
from app.feedback_transcription import preload_whisper_model
from app.ingestion import ingest_session
from app.models import User, UserRole
from app.session_schema import (
    SessionPayload,
    SessionStatusResponse,
)
from app.sop_generator_selector import get_sop_generator
from app.sop_schema import (
    SopApproveResponse,
    SopDetailPayload,
    SopLibraryItem,
    SopListResponse,
    SopPayload,
    SopPublishResponse,
    SopStepResponse,
    SopWarning,
    WalkthroughPayload,
)
from app.sop_service import (
    WalkthroughDataError,
    build_walkthrough_payload,
    resolve_step_screenshot_highlight,
    resolve_step_screenshot_url,
    resolve_step_time_estimate,
)
from app.storage import ObjectStorage, get_storage

load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI):
    preload_whisper_model()
    yield


app = FastAPI(title="H09A Apple API", lifespan=lifespan)

cors_origins = [o.strip() for o in os.getenv("API_CORS_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins or ["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(feedback_router)


@app.get("/health")
@app.get("/api/v1/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/v1/sessions", status_code=status.HTTP_201_CREATED)
def create_session(
    payload: SessionPayload,
    db: DBSession = Depends(get_db),
    storage: ObjectStorage = Depends(get_storage),
    current_user: User = Depends(require_role(UserRole.employee)),
) -> dict[str, str]:
    try:
        ingested_session = ingest_session(
            payload,
            db,
            tenant_id=current_user.tenant_id,
            storage=storage if payload.screenshots else None,
            recorded_by=current_user.id,
        )
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
    current_user: User = Depends(require_role(UserRole.employee)),
):
    session = (
        filter_by_tenant(db.query(models.Session), models.Session, current_user.tenant_id)
        .filter(models.Session.id == session_id)
        .first()
    )

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
        filter_by_tenant(db.query(models.Sop), models.Sop, current_user.tenant_id)
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
    current_user: User = Depends(require_role(UserRole.employee)),
):
    session = (
        filter_by_tenant(db.query(models.Session), models.Session, current_user.tenant_id)
        .filter(models.Session.id == session_id)
        .first()
    )

    if session is None:
        raise HTTPException(
            status_code=404,
            detail="Session not found",
        )

    existing = (
        filter_by_tenant(db.query(models.Sop), models.Sop, current_user.tenant_id)
        .filter(models.Sop.session_id == session_id)
        .first()
    )

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
            tenant_id=current_user.tenant_id,
            title=payload.title,
            steps=[step.model_dump() for step in payload.steps],
            warnings=[warning.model_dump() for warning in payload.warnings],
            generation_mode=payload.generation_mode,
            gen_duration_ms=gen_duration_ms,
        )
        db.add(sop)

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
    current_user: User = Depends(require_role(UserRole.employee)),
):
    sop = (
        filter_by_tenant(db.query(models.Sop), models.Sop, current_user.tenant_id)
        .filter(models.Sop.id == sop_id)
        .first()
    )

    if sop is None:
        raise HTTPException(status_code=404, detail="SOP not found")

    steps = []

    for step in sop.steps:
        source_event_ids = step.get("source_event_ids", [])
        time_estimate = resolve_step_time_estimate(
            source_event_ids,
            db,
            sop.session_id,
            current_user.tenant_id,
        )

        raw_time_estimate = step.get("time_estimate")

        if time_estimate is None:
            try:
                time_estimate = (
                    int(raw_time_estimate) if raw_time_estimate is not None else None
                )
            except (TypeError, ValueError):
                time_estimate = None

        steps.append(
            SopStepResponse(
                **{**step, "time_estimate": time_estimate},
                screenshot_url=resolve_step_screenshot_url(
                    source_event_ids,
                    db,
                    sop.session_id,
                    current_user.tenant_id,
                ),
                screenshot_highlight=resolve_step_screenshot_highlight(
                    source_event_ids,
                    db,
                    sop.session_id,
                ),
            )
        )

    warnings = [SopWarning.model_validate(warning) for warning in sop.warnings]

    return SopDetailPayload(
        id=str(sop.id),
        title=sop.title,
        summary=f"{len(steps)} step workflow",
        version=sop.version,
        generated_at=sop.generated_at,
        steps=steps,
        warnings=warnings,
    )


@app.get(
    "/api/v1/sops/{sop_id}/walkthrough",
    response_model=WalkthroughPayload,
)
def get_sop_walkthrough(
    sop_id: UUID,
    db: DBSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.employee)),
):
    sop = (
        filter_by_tenant(db.query(models.Sop), models.Sop, current_user.tenant_id)
        .filter(models.Sop.id == sop_id)
        .first()
    )

    if sop is None or sop.status != models.SopStatus.published.value or not sop.steps:
        raise HTTPException(status_code=404, detail="SOP not found")

    try:
        return build_walkthrough_payload(sop, db)
    except WalkthroughDataError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc


@app.post("/api/v1/sops/{sop_id}/approve", response_model=SopApproveResponse)
def approve_sop(
    sop_id: UUID,
    db: DBSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.reviewer)),
):
    sop = (
        filter_by_tenant(db.query(models.Sop), models.Sop, current_user.tenant_id)
        .filter(models.Sop.id == sop_id)
        .first()
    )

    if sop is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="SOP not found",
        )

    if sop.status not in (
        models.SopStatus.draft.value,
        models.SopStatus.needs_review.value,
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="SOP must be draft or needs_review before approval",
        )

    sop.status = models.SopStatus.approved.value

    try:
        db.commit()
    except Exception:
        db.rollback()
        raise

    db.refresh(sop)

    return SopApproveResponse(
        id=str(sop.id),
        status=sop.status,
    )


@app.post(
    "/api/v1/sops/{sop_id}/publish",
    response_model=SopPublishResponse,
)
def publish_sop(
    sop_id: UUID,
    db: DBSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.reviewer)),
):
    sop = (
        filter_by_tenant(db.query(models.Sop), models.Sop, current_user.tenant_id)
        .filter(models.Sop.id == sop_id)
        .first()
    )

    if sop is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="SOP not found",
        )

    if sop.status != models.SopStatus.approved.value:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="SOP must be approved before publishing",
        )

    sop.status = models.SopStatus.published.value
    sop.published_at = datetime.now(UTC)

    try:
        db.commit()
    except Exception:
        db.rollback()
        raise

    db.refresh(sop)

    return SopPublishResponse(
        id=str(sop.id),
        status=sop.status,
        published_at=sop.published_at,
        library_url=f"/library/sops/{sop.id}",
    )


@app.get(
    "/api/v1/sops",
    response_model=SopListResponse,
)
def list_sops(
    status_filter: models.SopStatus | None = Query(None, alias="status"),
    db: DBSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.employee)),
):
    query = filter_by_tenant(db.query(models.Sop), models.Sop, current_user.tenant_id)

    sop_status = (status_filter or models.SopStatus.published).value
    query = query.filter(models.Sop.status == sop_status)

    sops = query.all()

    return SopListResponse(
        sops=[
            SopLibraryItem(
                id=str(sop.id),
                title=sop.title,
                workflow_category=None,
                step_count=len(sop.steps),
                published_at=sop.published_at,
            )
            for sop in sops
        ]
    )
