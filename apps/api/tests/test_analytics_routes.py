from datetime import UTC, datetime
from uuid import uuid4

from fastapi.testclient import TestClient

from app import models
from app.analytics_cache import get_analytics_cache
from app.analytics_clustering import AnalyticsSopNotFoundError, InsufficientAnalyticsDataError
from app.analytics_schema import AnalyticsClusteringResponse
from app.auth.deps import get_current_user
from app.database import get_db
from app.main import app


def _user(role=models.UserRole.manager):
    return models.User(
        id=uuid4(),
        email=f"{role.value.lower()}@example.com",
        hashed_password="x",
        role=role.value,
        tenant_id=uuid4(),
    )


def _result(workflow_id):
    return AnalyticsClusteringResponse(
        workflow_id=workflow_id,
        k=3,
        clusters=[
            {
                "cluster_id": 0,
                "size": 1,
                "centroid_values": {"duration": 10.0},
                "member_session_ids": [str(uuid4())],
                "member_employee_ids": [str(uuid4())],
                "characteristics": ["low duration"],
            }
        ],
        assignments=[],
        outliers=[],
        silhouette_score=0.5,
        metadata={
            "session_count": 5,
            "feature_count": 1,
            "feature_names": ["duration"],
            "algorithm_version": "test-v1",
            "computed_at": datetime.now(UTC),
            "computation_time_ms": 12,
            "cached": False,
        },
    )


class _Query:
    def __init__(self, item):
        self.item = item

    def filter(self, *args):
        return self

    def order_by(self, *args):
        return self

    def one_or_none(self):
        return self.item

    def first(self):
        return self.item


class _Db:
    def __init__(self, *, sop=None, result=None):
        self.sop = sop
        self.result = result
        self.added = []
        self.commits = 0
        self.rollbacks = 0

    def query(self, model):
        return _Query(self.sop if model is models.Sop else self.result)

    def add(self, item):
        self.added.append(item)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


class _Cache:
    def __init__(self, result=None):
        self.result = result
        self.set_calls = []

    def get(self, **kwargs):
        return self.result

    def set(self, result, **kwargs):
        self.set_calls.append((result, kwargs))


def _request(db, user, cache, method, path, **kwargs):
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_analytics_cache] = lambda: cache
    try:
        return getattr(TestClient(app, raise_server_exceptions=False), method)(path, **kwargs)
    finally:
        app.dependency_overrides.clear()


def test_post_happy_path_persists_and_caches(monkeypatch):
    workflow_id = uuid4()
    user = _user()
    db = _Db()
    cache = _Cache()
    expected = _result(workflow_id)
    monkeypatch.setattr("app.analytics_routes.cluster_walkthroughs", lambda *a, **k: expected)

    response = _request(
        db,
        user,
        cache,
        "post",
        "/api/v1/analytics/kmeans",
        json={"workflow_id": str(workflow_id)},
    )

    assert response.status_code == 200
    assert set(response.json()) == {
        "workflow_id",
        "k",
        "clusters",
        "assignments",
        "outliers",
        "silhouette_score",
        "metadata",
    }
    assert db.commits == 1
    assert isinstance(db.added[0], models.ClusteringResult)
    assert cache.set_calls


def test_routes_require_manager_role():
    response = _request(
        _Db(),
        _user(models.UserRole.employee),
        _Cache(),
        "post",
        "/api/v1/analytics/kmeans",
        json={"workflow_id": str(uuid4())},
    )
    assert response.status_code == 403


def test_get_returns_404_for_unknown_sop():
    response = _request(
        _Db(sop=None),
        _user(),
        _Cache(),
        "get",
        f"/api/v1/analytics/kmeans/{uuid4()}",
    )
    assert response.status_code == 404


def test_post_returns_404_for_unknown_sop(monkeypatch):
    def fail(*args, **kwargs):
        raise AnalyticsSopNotFoundError("SOP not found")

    monkeypatch.setattr("app.analytics_routes.cluster_walkthroughs", fail)
    response = _request(
        _Db(),
        _user(),
        _Cache(),
        "post",
        "/api/v1/analytics/kmeans",
        json={"workflow_id": str(uuid4())},
    )
    assert response.status_code == 404


def test_post_returns_422_for_insufficient_data(monkeypatch):
    def fail(*args, **kwargs):
        raise InsufficientAnalyticsDataError("Need at least 5 sessions")

    monkeypatch.setattr("app.analytics_routes.cluster_walkthroughs", fail)
    response = _request(
        _Db(),
        _user(),
        _Cache(),
        "post",
        "/api/v1/analytics/kmeans",
        json={"workflow_id": str(uuid4())},
    )
    assert response.status_code == 422


def test_post_rolls_back_unexpected_failure(monkeypatch):
    def fail(*args, **kwargs):
        raise RuntimeError("database failed")

    monkeypatch.setattr("app.analytics_routes.cluster_walkthroughs", fail)
    db = _Db()
    response = _request(
        db,
        _user(),
        _Cache(),
        "post",
        "/api/v1/analytics/kmeans",
        json={"workflow_id": str(uuid4())},
    )
    assert response.status_code == 500
    assert db.rollbacks == 1


def test_get_uses_cache_before_result_table():
    workflow_id = uuid4()
    cached = _result(workflow_id)
    cached.metadata.cached = True
    response = _request(
        _Db(sop=object()),
        _user(),
        _Cache(cached),
        "get",
        f"/api/v1/analytics/kmeans/{workflow_id}",
    )
    assert response.status_code == 200
    assert response.json()["metadata"]["cached"] is True


def test_get_cache_miss_reads_latest_database_result_and_refills_cache():
    workflow_id = uuid4()
    stored = _result(workflow_id)
    record = models.ClusteringResult(
        workflow_id=workflow_id,
        tenant_id=uuid4(),
        k=stored.k,
        cluster_centers=[item.centroid_values for item in stored.clusters],
        session_cluster_assignments=[],
        clusters=[item.model_dump(mode="json") for item in stored.clusters],
        outliers=[],
        silhouette=stored.silhouette_score,
        analytics_metadata=stored.metadata.model_dump(
            mode="json", exclude={"algorithm_version", "computed_at"}
        ),
        algorithm_version=stored.metadata.algorithm_version,
        computed_at=stored.metadata.computed_at,
    )
    cache = _Cache()

    response = _request(
        _Db(sop=object(), result=record),
        _user(),
        cache,
        "get",
        f"/api/v1/analytics/kmeans/{workflow_id}",
    )

    assert response.status_code == 200
    assert response.json()["metadata"]["cached"] is False
    assert cache.set_calls
