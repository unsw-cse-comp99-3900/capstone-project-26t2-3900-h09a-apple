from __future__ import annotations

import logging
import os
from typing import Protocol
from uuid import UUID

import redis

from app.analytics_schema import AnalyticsClusteringResponse

logger = logging.getLogger(__name__)

DEFAULT_CACHE_TTL_SECONDS = 3600


class RedisClient(Protocol):
    def get(self, name: str) -> bytes | str | None: ...

    def setex(self, name: str, time: int, value: str) -> object: ...


class AnalyticsCache:
    def __init__(
        self,
        client: RedisClient | None,
        *,
        ttl_seconds: int = DEFAULT_CACHE_TTL_SECONDS,
    ) -> None:
        self.client = client
        self.ttl_seconds = ttl_seconds

    @staticmethod
    def key(tenant_id: UUID, workflow_id: UUID) -> str:
        return f"analytics:kmeans:{tenant_id}:{workflow_id}"

    def get(
        self,
        *,
        tenant_id: UUID,
        workflow_id: UUID,
    ) -> AnalyticsClusteringResponse | None:
        if self.client is None:
            return None
        try:
            payload = self.client.get(self.key(tenant_id, workflow_id))
            if payload is None:
                return None
            result = AnalyticsClusteringResponse.model_validate_json(payload)
            return result.model_copy(
                update={
                    "metadata": result.metadata.model_copy(update={"cached": True}),
                }
            )
        except Exception:
            logger.warning("Redis analytics cache read failed; using database", exc_info=True)
            return None

    def set(
        self,
        result: AnalyticsClusteringResponse,
        *,
        tenant_id: UUID,
        workflow_id: UUID,
    ) -> None:
        if self.client is None:
            return
        try:
            self.client.setex(
                self.key(tenant_id, workflow_id),
                self.ttl_seconds,
                result.model_dump_json(),
            )
        except Exception:
            logger.warning("Redis analytics cache write failed", exc_info=True)


def get_analytics_cache() -> AnalyticsCache:
    redis_url = os.getenv("REDIS_URL")
    ttl_seconds = int(os.getenv("ANALYTICS_CACHE_TTL_SECONDS", DEFAULT_CACHE_TTL_SECONDS))
    client = redis.Redis.from_url(redis_url) if redis_url else None
    return AnalyticsCache(client, ttl_seconds=ttl_seconds)


__all__ = ["AnalyticsCache", "get_analytics_cache"]
