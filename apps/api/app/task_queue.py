from __future__ import annotations

import os

from celery import Celery


def _redis_url() -> str:
    return os.getenv("REDIS_URL", "redis://localhost:6379/0")


celery_app = Celery(
    "worktrace",
    broker=_redis_url(),
    backend=_redis_url(),
    include=["app.friction_tasks"],
)
celery_app.conf.update(
    broker_connection_retry_on_startup=True,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    task_track_started=True,
    worker_prefetch_multiplier=1,
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    task_soft_time_limit=170,
    task_time_limit=180,
)


__all__ = ["celery_app"]
