"""Role-aware dashboard summary KPIs (H09AAPPLE-57)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session as DBSession

from app import models
from app.auth.deps import filter_by_tenant, require_role
from app.database import get_db
from app.models import User, UserRole

router = APIRouter(prefix="/api/v1/dashboard", tags=["dashboard"])


class DashboardKpi(BaseModel):
    id: str
    label: str
    value: str
    delta: float
    unit: str | None = None


class DashboardListItem(BaseModel):
    id: str
    title: str
    meta: str = ""


class DashboardSummaryResponse(BaseModel):
    role: str
    greeting: str
    kpis: list[DashboardKpi] = Field(default_factory=list)
    primary_items: list[DashboardListItem] = Field(default_factory=list)


def _period_bounds() -> tuple[datetime, datetime, datetime]:
    now = datetime.now(UTC)
    current_start = now - timedelta(days=7)
    previous_start = now - timedelta(days=14)
    return previous_start, current_start, now


def _fmt_number(value: float | int) -> str:
    if isinstance(value, float) and not value.is_integer():
        return f"{value:.1f}"
    return str(int(value))


def _employee_summary(db: DBSession, user: User) -> DashboardSummaryResponse:
    previous_start, current_start, now = _period_bounds()

    def completion_count(start: datetime, end: datetime) -> int:
        return (
            filter_by_tenant(
                db.query(models.WalkthroughCompletion), models.WalkthroughCompletion, user.tenant_id
            )
            .filter(
                models.WalkthroughCompletion.employee_id == user.id,
                models.WalkthroughCompletion.completed_at >= start,
                models.WalkthroughCompletion.completed_at < end,
            )
            .count()
        )

    current_count = completion_count(current_start, now)
    previous_count = completion_count(previous_start, current_start)

    def avg_duration(start: datetime, end: datetime) -> float:
        value = (
            filter_by_tenant(
                db.query(func.avg(models.WalkthroughCompletion.duration_seconds)),
                models.WalkthroughCompletion,
                user.tenant_id,
            )
            .filter(
                models.WalkthroughCompletion.employee_id == user.id,
                models.WalkthroughCompletion.completed_at >= start,
                models.WalkthroughCompletion.completed_at < end,
            )
            .scalar()
        )
        return float(value or 0)

    current_avg = avg_duration(current_start, now)
    previous_avg = avg_duration(previous_start, current_start)

    def avg_friction(start: datetime, end: datetime) -> float:
        value = (
            db.query(func.avg(models.FrictionEmployeeStepScore.score))
            .join(
                models.FrictionAnalysis,
                models.FrictionAnalysis.id == models.FrictionEmployeeStepScore.analysis_id,
            )
            .join(
                models.WalkthroughCompletion,
                models.WalkthroughCompletion.id == models.FrictionEmployeeStepScore.completion_id,
            )
            .filter(
                models.FrictionEmployeeStepScore.employee_id == user.id,
                models.FrictionAnalysis.tenant_id == user.tenant_id,
                models.WalkthroughCompletion.completed_at >= start,
                models.WalkthroughCompletion.completed_at < end,
            )
            .scalar()
        )
        return float(value or 0)

    current_friction = avg_friction(current_start, now)
    previous_friction = avg_friction(previous_start, current_start)
    # Lifetime average remains the KPI value employees care about.
    friction_avg = (
        db.query(func.avg(models.FrictionEmployeeStepScore.score))
        .join(
            models.FrictionAnalysis,
            models.FrictionAnalysis.id == models.FrictionEmployeeStepScore.analysis_id,
        )
        .filter(
            models.FrictionEmployeeStepScore.employee_id == user.id,
            models.FrictionAnalysis.tenant_id == user.tenant_id,
        )
        .scalar()
    )
    friction_value = float(friction_avg or 0)

    unread = (
        filter_by_tenant(
            db.query(models.FeedbackNotification), models.FeedbackNotification, user.tenant_id
        )
        .filter(
            models.FeedbackNotification.recipient_id == user.id,
            models.FeedbackNotification.read_at.is_(None),
        )
        .count()
    )

    def unread_created(start: datetime, end: datetime) -> int:
        return (
            filter_by_tenant(
                db.query(models.FeedbackNotification),
                models.FeedbackNotification,
                user.tenant_id,
            )
            .filter(
                models.FeedbackNotification.recipient_id == user.id,
                models.FeedbackNotification.created_at >= start,
                models.FeedbackNotification.created_at < end,
            )
            .count()
        )

    unread_delta = float(
        unread_created(current_start, now) - unread_created(previous_start, current_start)
    )

    recent = (
        filter_by_tenant(
            db.query(models.WalkthroughCompletion), models.WalkthroughCompletion, user.tenant_id
        )
        .filter(models.WalkthroughCompletion.employee_id == user.id)
        .order_by(models.WalkthroughCompletion.completed_at.desc())
        .limit(8)
        .all()
    )
    sop_ids = [row.sop_id for row in recent]
    titles: dict[UUID, str] = {}
    if sop_ids:
        for sop in db.query(models.Sop).filter(models.Sop.id.in_(sop_ids)).all():
            titles[sop.id] = sop.title

    return DashboardSummaryResponse(
        role=UserRole.employee.value,
        greeting="Your walkthrough activity this week",
        kpis=[
            DashboardKpi(
                id="walkthroughs",
                label="Walkthroughs completed",
                value=_fmt_number(current_count),
                delta=float(current_count - previous_count),
            ),
            DashboardKpi(
                id="avg_time",
                label="Average completion time",
                value=_fmt_number(current_avg),
                delta=round(current_avg - previous_avg, 1),
                unit="s",
            ),
            DashboardKpi(
                id="my_friction",
                label="My average friction score",
                value=_fmt_number(friction_value),
                delta=round(current_friction - previous_friction, 1),
            ),
            DashboardKpi(
                id="unread",
                label="Unread notifications",
                value=_fmt_number(unread),
                delta=unread_delta,
            ),
        ],
        primary_items=[
            DashboardListItem(
                id=str(row.id),
                title=titles.get(row.sop_id, "Walkthrough"),
                meta=row.completed_at.strftime("%Y-%m-%d") if row.completed_at else "",
            )
            for row in recent
        ],
    )


def _reviewer_summary(db: DBSession, user: User) -> DashboardSummaryResponse:
    previous_start, current_start, now = _period_bounds()

    pending = (
        filter_by_tenant(db.query(models.Sop), models.Sop, user.tenant_id)
        .filter(models.Sop.status == models.SopStatus.needs_review.value)
        .count()
    )
    reviewed_week = (
        filter_by_tenant(db.query(models.VoiceFeedback), models.VoiceFeedback, user.tenant_id)
        .filter(
            models.VoiceFeedback.reviewed_by == user.id,
            models.VoiceFeedback.reviewed_at.is_not(None),
            models.VoiceFeedback.reviewed_at >= current_start,
        )
        .count()
    )
    published = (
        filter_by_tenant(db.query(models.Sop), models.Sop, user.tenant_id)
        .filter(
            models.Sop.status == models.SopStatus.published.value,
            models.Sop.published_at.is_not(None),
            models.Sop.published_at >= current_start,
        )
        .count()
    )
    awaiting = (
        filter_by_tenant(db.query(models.VoiceFeedback), models.VoiceFeedback, user.tenant_id)
        .filter(models.VoiceFeedback.status == models.FeedbackReviewStatus.pending.value)
        .count()
    )

    queue = (
        filter_by_tenant(db.query(models.Sop), models.Sop, user.tenant_id)
        .filter(models.Sop.status == models.SopStatus.needs_review.value)
        .order_by(models.Sop.generated_at.desc())
        .limit(8)
        .all()
    )
    _ = previous_start

    return DashboardSummaryResponse(
        role=UserRole.reviewer.value,
        greeting="Review queue and feedback awaiting action",
        kpis=[
            DashboardKpi(
                id="pending", label="Pending review queue", value=_fmt_number(pending), delta=0
            ),
            DashboardKpi(
                id="reviewed_week",
                label="Reviewed this week",
                value=_fmt_number(reviewed_week),
                delta=float(reviewed_week),
            ),
            DashboardKpi(
                id="published",
                label="SOPs published after review",
                value=_fmt_number(published),
                delta=float(published),
            ),
            DashboardKpi(
                id="feedback_open",
                label="Feedback awaiting action",
                value=_fmt_number(awaiting),
                delta=0,
            ),
        ],
        primary_items=[
            DashboardListItem(id=str(sop.id), title=sop.title, meta=sop.status) for sop in queue
        ],
    )


def _manager_summary(db: DBSession, user: User) -> DashboardSummaryResponse:
    previous_start, current_start, now = _period_bounds()
    _ = (previous_start, current_start, now)

    workflows = (
        filter_by_tenant(db.query(models.Sop), models.Sop, user.tenant_id)
        .filter(models.Sop.status == models.SopStatus.published.value)
        .count()
    )
    high_variance = (
        db.query(models.FrictionAnalysis.id)
        .join(
            models.FrictionEmployeeStepScore,
            models.FrictionEmployeeStepScore.analysis_id == models.FrictionAnalysis.id,
        )
        .filter(
            models.FrictionAnalysis.tenant_id == user.tenant_id,
            models.FrictionAnalysis.status == models.FrictionAnalysisStatus.completed.value,
            models.FrictionEmployeeStepScore.is_outlier.is_(True),
        )
        .distinct()
        .count()
    )
    sessions = filter_by_tenant(
        db.query(models.WalkthroughCompletion), models.WalkthroughCompletion, user.tenant_id
    ).count()
    pending_reviews = (
        filter_by_tenant(db.query(models.Sop), models.Sop, user.tenant_id)
        .filter(models.Sop.status == models.SopStatus.needs_review.value)
        .count()
    )

    return DashboardSummaryResponse(
        role=UserRole.manager.value,
        greeting="Tenant friction and review load",
        kpis=[
            DashboardKpi(
                id="workflows", label="Total workflows", value=_fmt_number(workflows), delta=0
            ),
            DashboardKpi(
                id="high_variance",
                label="High-variance workflows",
                value=_fmt_number(high_variance),
                delta=0,
            ),
            DashboardKpi(
                id="sessions", label="Total sessions", value=_fmt_number(sessions), delta=0
            ),
            DashboardKpi(
                id="pending_reviews",
                label="Pending reviews",
                value=_fmt_number(pending_reviews),
                delta=0,
            ),
        ],
        primary_items=[],
    )


@router.get("/summary", response_model=DashboardSummaryResponse)
def get_dashboard_summary(
    current_user: Annotated[User, Depends(require_role(UserRole.employee))],
    db: Annotated[DBSession, Depends(get_db)],
) -> DashboardSummaryResponse:
    role = (
        current_user.role
        if isinstance(current_user.role, UserRole)
        else UserRole(str(current_user.role))
    )
    if role == UserRole.manager:
        return _manager_summary(db, current_user)
    if role == UserRole.reviewer:
        return _reviewer_summary(db, current_user)
    return _employee_summary(db, current_user)


__all__ = ["router"]
