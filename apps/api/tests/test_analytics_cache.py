from datetime import UTC, datetime
from uuid import uuid4

from app.analytics_cache import AnalyticsCache
from app.analytics_schema import AnalyticsClusteringResponse


def _result(workflow_id):
    return AnalyticsClusteringResponse(
        workflow_id=workflow_id,
        k=2,
        clusters=[],
        assignments=[],
        outliers=[],
        silhouette_score=None,
        metadata={
            "session_count": 5,
            "feature_count": 1,
            "feature_names": ["duration"],
            "algorithm_version": "test-v1",
            "computed_at": datetime.now(UTC),
            "computation_time_ms": 4,
            "cached": False,
        },
    )


class _Redis:
    def __init__(self):
        self.values = {}
        self.setex_calls = []

    def get(self, name):
        return self.values.get(name)

    def setex(self, name, time, value):
        self.setex_calls.append((name, time, value))
        self.values[name] = value


class _BrokenRedis:
    def get(self, name):
        raise ConnectionError("redis unavailable")

    def setex(self, name, time, value):
        raise ConnectionError("redis unavailable")


def test_cache_roundtrip_uses_tenant_and_workflow_key():
    tenant_id = uuid4()
    workflow_id = uuid4()
    redis = _Redis()
    cache = AnalyticsCache(redis, ttl_seconds=123)
    result = _result(workflow_id)

    assert cache.get(tenant_id=tenant_id, workflow_id=workflow_id) is None
    cache.set(result, tenant_id=tenant_id, workflow_id=workflow_id)
    cached = cache.get(tenant_id=tenant_id, workflow_id=workflow_id)

    assert redis.setex_calls[0][0] == f"analytics:kmeans:{tenant_id}:{workflow_id}"
    assert redis.setex_calls[0][1] == 123
    assert cached is not None
    assert cached.metadata.cached is True
    assert cached.workflow_id == workflow_id


def test_cache_failure_degrades_to_miss(caplog):
    cache = AnalyticsCache(_BrokenRedis())
    tenant_id = uuid4()
    workflow_id = uuid4()

    assert cache.get(tenant_id=tenant_id, workflow_id=workflow_id) is None
    cache.set(_result(workflow_id), tenant_id=tenant_id, workflow_id=workflow_id)

    assert "Redis analytics cache" in caplog.text
