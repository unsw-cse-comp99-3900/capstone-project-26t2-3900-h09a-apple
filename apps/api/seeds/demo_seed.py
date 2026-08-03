from __future__ import annotations

import sys
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy.orm import Session

from app import models
from app.database import get_sessionmaker
from app.sop_embeddings import enqueue_embed_job, process_embed_job

DEMO_CLIENT_SESSION_ID = UUID("11111111-1111-1111-1111-111111111111")
TENANT_ID = UUID("22222222-2222-2222-2222-222222222222")

WORKFLOW_NAME = "Chief of Staff - Outlook Desktop to Claude"
SOP_TITLE = "Chief of Staff Daily Brief Workflow"

EMPLOYEE_EMAIL = "demo.employee@worktrace.local"
REVIEWER_EMAIL = "demo.reviewer@worktrace.local"
MANAGER_EMAIL = "demo.manager@worktrace.local"

PASSWORD_HASH = "$demo$"


def utc_now() -> datetime:
    return datetime.now(UTC)


# ------------------------------------------------------------------
# Helpers & Users
# ------------------------------------------------------------------


def get_or_create_user(
    db: Session,
    *,
    email: str,
    role: models.UserRole,
) -> models.User:
    user = (
        db.query(models.User)
        .filter(
            models.User.email == email,
            models.User.tenant_id == TENANT_ID,
        )
        .first()
    )

    if user:
        return user

    user = models.User(
        email=email,
        hashed_password=PASSWORD_HASH,
        role=role.value,
        tenant_id=TENANT_ID,
    )

    db.add(user)
    db.flush()

    return user


def ensure_demo_users(
    db: Session,
) -> tuple[models.User, models.User, models.User]:
    employee = get_or_create_user(
        db,
        email=EMPLOYEE_EMAIL,
        role=models.UserRole.employee,
    )

    reviewer = get_or_create_user(
        db,
        email=REVIEWER_EMAIL,
        role=models.UserRole.reviewer,
    )

    manager = get_or_create_user(
        db,
        email=MANAGER_EMAIL,
        role=models.UserRole.manager,
    )

    return employee, reviewer, manager


# ------------------------------------------------------------------
# Session
# ------------------------------------------------------------------


def ensure_demo_session(
    db: Session,
    *,
    employee: models.User,
) -> models.Session:

    session = (
        db.query(models.Session)
        .filter(
            models.Session.tenant_id == TENANT_ID,
            models.Session.client_session_id == DEMO_CLIENT_SESSION_ID,
        )
        .first()
    )

    if session:
        return session

    started = utc_now() - timedelta(days=1)

    session = models.Session(
        tenant_id=TENANT_ID,
        client_session_id=DEMO_CLIENT_SESSION_ID,
        recorded_by=employee.id,
        workflow_name=WORKFLOW_NAME,
        status=models.SessionStatus.processed.value,
        started_at=started,
        stopped_at=started + timedelta(minutes=4),
        event_count=27,
    )

    db.add(session)
    db.flush()

    return session


# ------------------------------------------------------------------
# SOP
# ------------------------------------------------------------------


DEMO_STEPS = [
    {
        "order": 1,
        "title": "Open Outlook",
        "instruction": "Open Outlook Desktop and review unread emails.",
        "branch": "main",
        "source_event_ids": [],
    },
    {
        "order": 2,
        "title": "Identify Action Items",
        "instruction": "Collect important action items from the inbox.",
        "branch": "main",
        "source_event_ids": [],
    },
    {
        "order": 3,
        "title": "Generate Claude Prompt",
        "instruction": "Write a structured prompt and paste it into Claude.",
        "branch": "main",
        "source_event_ids": [],
    },
    {
        "order": 4,
        "title": "Review Summary",
        "instruction": "Review Claude's summary and send the final daily brief.",
        "branch": "main",
        "source_event_ids": [],
    },
]


def ensure_demo_sop(
    db: Session,
    *,
    session: models.Session,
) -> models.Sop:

    sop = (
        db.query(models.Sop)
        .filter(
            models.Sop.tenant_id == TENANT_ID,
            models.Sop.session_id == session.id,
            models.Sop.version == 1,
        )
        .first()
    )

    if sop:
        return sop

    sop = models.Sop(
        session_id=session.id,
        tenant_id=TENANT_ID,
        title=SOP_TITLE,
        version=1,
        status=models.SopStatus.published.value,
        steps=DEMO_STEPS,
        warnings=[],
        generation_mode="llm",
        generated_at=utc_now(),
        published_at=utc_now(),
        gen_duration_ms=1800,
    )

    db.add(sop)
    db.flush()

    return sop


# ------------------------------------------------------------------
# Embeddings
# ------------------------------------------------------------------


def ensure_demo_embeddings(
    db: Session,
    *,
    sop: models.Sop,
) -> None:
    """
    Generate deterministic embeddings once.

    Idempotent:
    - skip if embedding already completed
    """

    if sop.embedding_status == models.EmbeddingStatus.complete.value:
        return

    job = enqueue_embed_job(db, sop)

    db.commit()

    process_embed_job(str(job.id))

    # Expire and refresh to prevent reading stale cached state after process_embed_job
    db.expire(sop)
    db.refresh(sop)


# ------------------------------------------------------------------
# Walkthrough
# ------------------------------------------------------------------


TIMING_VARIANTS = [
    [4000, 5000, 3000, 4000],
    [6000, 5000, 3000, 4000],
    [4000, 9000, 3000, 4000],
    [4000, 35000, 3000, 4000],  # deliberate outlier
]


def ensure_demo_walkthroughs(
    db: Session,
    *,
    sop: models.Sop,
    employee: models.User,
) -> None:

    completions = (
        db.query(models.WalkthroughCompletion)
        .filter(
            models.WalkthroughCompletion.sop_id == sop.id,
            models.WalkthroughCompletion.employee_id == employee.id,
        )
        .all()
    )

    # Return early if exact target number of walkthroughs already exists
    if len(completions) == len(TIMING_VARIANTS):
        return

    # Purge existing stale/partial walkthroughs to enforce exact 4 deterministic records
    if completions:
        completion_ids = [c.id for c in completions]

        db.query(models.WalkthroughFrictionEvent).filter(
            models.WalkthroughFrictionEvent.completion_id.in_(completion_ids)
        ).delete(synchronize_session=False)

        db.query(models.WalkthroughStepTiming).filter(
            models.WalkthroughStepTiming.completion_id.in_(completion_ids)
        ).delete(synchronize_session=False)

        db.query(models.WalkthroughCompletion).filter(
            models.WalkthroughCompletion.id.in_(completion_ids)
        ).delete(synchronize_session=False)

        db.flush()

    # Re-insert deterministic walkthrough variants
    base_time = utc_now() - timedelta(hours=3)

    for index, timings in enumerate(TIMING_VARIANTS):

        completed = models.WalkthroughCompletion(
            tenant_id=TENANT_ID,
            sop_id=sop.id,
            employee_id=employee.id,
            completed_at=base_time + timedelta(minutes=index * 15),
            duration_seconds=sum(timings) // 1000,
            step_sequence=[1, 2, 3, 4],
            user_role=models.UserRole.employee.value,
        )

        db.add(completed)
        db.flush()

        for step_number, duration in enumerate(timings, start=1):

            db.add(
                models.WalkthroughStepTiming(
                    completion_id=completed.id,
                    step_number=step_number,
                    duration_ms=duration,
                )
            )

        # Attach friction event exclusively to the 4th variant (outlier)
        if index == 3:
            db.add(
                models.WalkthroughFrictionEvent(
                    completion_id=completed.id,
                    step_number=2,
                    event_type=models.WalkthroughFrictionType.wrong_target.value,
                    occurred_at=completed.completed_at,
                )
            )

    db.flush()


# ------------------------------------------------------------------
# Friction Analysis
# ------------------------------------------------------------------


def ensure_demo_friction_analysis(
    db: Session,
    *,
    sop: models.Sop,
) -> None:

    analysis = (
        db.query(models.FrictionAnalysis)
        .filter(
            models.FrictionAnalysis.sop_id == sop.id,
            models.FrictionAnalysis.tenant_id == TENANT_ID,
        )
        .first()
    )

    if analysis:
        return

    analysis = models.FrictionAnalysis(
        tenant_id=TENANT_ID,
        sop_id=sop.id,
        status=models.FrictionAnalysisStatus.completed.value,
        overall_score=42,
        highest_friction_step=2,
        employee_count=4,
        started_at=utc_now(),
        completed_at=utc_now(),
    )

    db.add(analysis)
    db.flush()


# ------------------------------------------------------------------
# Main Runner & CLI Entry
# ------------------------------------------------------------------


def seed_demo_data(db: Session) -> None:
    """Main execution pipeline with transaction management."""
    print("Starting Demo Environment Seeding...")
    try:
        employee, reviewer, manager = ensure_demo_users(db)
        print(f"  - Users verified/created ({EMPLOYEE_EMAIL})")

        session = ensure_demo_session(db, employee=employee)
        print(f"  - Session verified/created (ID: {session.id})")

        sop = ensure_demo_sop(db, session=session)
        print(f"  - SOP verified/created (Title: '{sop.title}')")

        ensure_demo_embeddings(db, sop=sop)
        print(f"  - Embeddings generated (Status: {sop.embedding_status})")

        ensure_demo_walkthroughs(db, sop=sop, employee=employee)
        print("  - Walkthrough completions & timings seeded (4 variants)")

        ensure_demo_friction_analysis(db, sop=sop)
        print("  - Friction analysis seeded")

        db.commit()
        print("Demo Seed completed successfully!")

    except Exception as e:
        db.rollback()
        print(f"Demo Seed failed! Rolling back changes. Error: {e}", file=sys.stderr)
        raise e


# ------------------------------------------------------------------
# Public API & CLI Entry
# ------------------------------------------------------------------


def seed_demo() -> None:
    """Public helper function for tests and scripts to execute seeding with a fresh DB session."""
    session_factory = get_sessionmaker()
    with session_factory() as db_session:
        seed_demo_data(db_session)


if __name__ == "__main__":
    seed_demo()
