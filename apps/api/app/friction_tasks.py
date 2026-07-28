from __future__ import annotations

import logging
from datetime import UTC, datetime
from uuid import UUID

from app import models
from app.database import get_sessionmaker
from app.friction_calculation import calculate_friction_analysis
from app.friction_notifications import publish_friction_update
from app.task_queue import celery_app

logger = logging.getLogger(__name__)


def enqueue_friction_calculation(analysis_id: UUID | str) -> str:
    result = calculate_friction.delay(str(analysis_id))
    return str(result.id)


def _notification(analysis: models.FrictionAnalysis) -> dict:
    return {
        "event": "friction_analysis.updated",
        "analysis_id": str(analysis.id),
        "sop_id": str(analysis.sop_id),
        "status": analysis.status,
        "overall_score": (
            float(analysis.overall_score) if analysis.overall_score is not None else None
        ),
        "highest_friction_step": analysis.highest_friction_step,
        "employee_count": analysis.employee_count,
        "completed_at": analysis.completed_at.isoformat() if analysis.completed_at else None,
    }


@celery_app.task(name="friction_calculation.triggered")
def calculate_friction(analysis_id: str) -> dict:
    session = get_sessionmaker()()
    analysis_uuid = UUID(analysis_id)
    try:
        analysis = (
            session.query(models.FrictionAnalysis)
            .filter(models.FrictionAnalysis.id == analysis_uuid)
            .one_or_none()
        )
        if analysis is None:
            raise ValueError(f"Friction analysis {analysis_id} not found")
        if analysis.status == models.FrictionAnalysisStatus.completed.value:
            return _notification(analysis)

        analysis.status = models.FrictionAnalysisStatus.processing.value
        analysis.started_at = datetime.now(UTC)
        analysis.error_message = None
        session.commit()

        calculate_friction_analysis(session, analysis)
        analysis.status = models.FrictionAnalysisStatus.completed.value
        analysis.completed_at = datetime.now(UTC)
        session.commit()
        session.refresh(analysis)

        payload = _notification(analysis)
        publish_friction_update(analysis.tenant_id, payload)
        return payload
    except Exception as exc:
        session.rollback()
        failed = (
            session.query(models.FrictionAnalysis)
            .filter(models.FrictionAnalysis.id == analysis_uuid)
            .one_or_none()
        )
        if failed is not None:
            failed.status = models.FrictionAnalysisStatus.failed.value
            failed.error_message = str(exc)[:2000]
            failed.completed_at = datetime.now(UTC)
            session.commit()
            publish_friction_update(failed.tenant_id, _notification(failed))
        logger.exception("Friction calculation failed analysis_id=%s", analysis_id)
        raise
    finally:
        session.close()


__all__ = ["calculate_friction", "enqueue_friction_calculation"]
