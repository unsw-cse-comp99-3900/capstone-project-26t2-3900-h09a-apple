from __future__ import annotations

import json
import logging
import os
from uuid import UUID

import redis

logger = logging.getLogger(__name__)
CHANNEL_PREFIX = "friction:updates"


def friction_channel(tenant_id: UUID | str) -> str:
    return f"{CHANNEL_PREFIX}:{tenant_id}"


def publish_friction_update(tenant_id: UUID | str, payload: dict) -> None:
    """Publish a best-effort dashboard notification without failing the job."""

    try:
        client = redis.Redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379/0"))
        client.publish(friction_channel(tenant_id), json.dumps(payload))
        client.close()
    except Exception:
        logger.warning("Could not publish friction WebSocket update", exc_info=True)


__all__ = ["friction_channel", "publish_friction_update"]
