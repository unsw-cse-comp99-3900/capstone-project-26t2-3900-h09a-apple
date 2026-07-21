from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

import numpy as np
import pytest

from app import models
from app.sop_embeddings import EMBEDDING_DIM, MockEmbeddingClient
from app.workflow_clustering import (
    HIGH_VARIANCE_THRESHOLD,
    MIN_SESSIONS_FOR_CLUSTERING,
    InsufficientClusterDataError,
    candidate_k_values,
    cluster_workflow,
    cosine_distance,
    mean_pairwise_cosine_distance,
    mean_pool_session_vector,
    select_kmeans_model,
)


def _unit(seed: str) -> list[float]:
    return MockEmbeddingClient().embed(seed).vector


class _Query:
    def __init__(self, rows):
        self.rows = list(rows)
        self._filters = []

    def join(self, *args, **kwargs):
        return self

    def filter(self, *args, **kwargs):
        return self

    def order_by(self, *args, **kwargs):
        return self

    def delete(self, synchronize_session=False):
        deleted = len(self.rows)
        self.rows.clear()
        return deleted

    def all(self):
        return list(self.rows)

    def first(self):
        return self.rows[0] if self.rows else None

    def count(self):
        return len(self.rows)


class ClusterFakeDb:
    def __init__(self, sops, embeddings_by_sop):
        self.sops = sops
        self.embeddings_by_sop = embeddings_by_sop
        self.clusters: list[models.WorkflowCluster] = []
        self.step_variances: list[models.WorkflowStepVariance] = []
        self.committed = False

    def query(self, model):
        if model is models.Sop:
            return _Query(self.sops)
        if model is models.SopStepEmbedding:
            # Caller always filters by sop_id; expose all rows and let tests
            # assign per-sop lists through a thin wrapper.
            return _EmbeddingQuery(self.embeddings_by_sop)
        if model is models.WorkflowCluster:
            return _Query(self.clusters)
        if model is models.WorkflowStepVariance:
            return _Query(self.step_variances)
        return _Query([])

    def add(self, item):
        if isinstance(item, models.WorkflowCluster):
            self.clusters.append(item)
        elif isinstance(item, models.WorkflowStepVariance):
            self.step_variances.append(item)

    def commit(self):
        self.committed = True


class _EmbeddingQuery:
    def __init__(self, embeddings_by_sop):
        self.embeddings_by_sop = embeddings_by_sop
        self._sop_id = None

    def filter(self, *criteria):
        for criterion in criteria:
            left = getattr(criterion, "left", None)
            right = getattr(criterion, "right", None)
            key = getattr(left, "key", None) if left is not None else None
            if key == "sop_id":
                value = getattr(right, "value", right)
                self._sop_id = value
        return self

    def order_by(self, *args, **kwargs):
        return self

    def all(self):
        if self._sop_id is None:
            return []
        return list(self.embeddings_by_sop.get(self._sop_id, []))


def _published_sop(workflow_name: str, tenant_id, session_id=None, sop_id=None):
    session_id = session_id or uuid4()
    sop_id = sop_id or uuid4()
    session = models.Session(
        id=session_id,
        tenant_id=tenant_id,
        client_session_id=str(uuid4()),
        workflow_name=workflow_name,
        recorded_by=None,
        started_at=datetime.now(UTC),
        stopped_at=datetime.now(UTC),
        status=models.SessionStatus.captured.value,
    )
    sop = models.Sop(
        id=sop_id,
        session_id=session_id,
        tenant_id=tenant_id,
        title=f"SOP for {workflow_name}",
        version=1,
        status=models.SopStatus.published.value,
        steps=[
            {"order": 1, "title": "One", "instruction": "Do one", "source_event_ids": ["1"]},
            {"order": 2, "title": "Two", "instruction": "Do two", "source_event_ids": ["2"]},
        ],
        warnings=[],
        generation_mode="llm",
        generated_at=datetime.now(UTC),
        published_at=datetime.now(UTC),
        embedding_status=models.EmbeddingStatus.complete.value,
    )
    sop.session = session
    return sop


def test_candidate_k_values_respect_sample_size():
    assert candidate_k_values(2) == []
    assert candidate_k_values(3) == [2]
    assert candidate_k_values(4) == [2, 3]
    assert candidate_k_values(5) == [2, 3, 4]


def test_mean_pool_session_vector_normalizes():
    vector = mean_pool_session_vector([[3.0, 0.0], [0.0, 4.0]])
    assert vector.shape == (2,)
    assert np.isclose(np.linalg.norm(vector), 1.0)


def test_mean_pairwise_cosine_distance_zero_for_identical_vectors():
    vector = _unit("same")
    assert mean_pairwise_cosine_distance([vector, vector, vector]) == pytest.approx(0.0, abs=1e-6)


def test_select_kmeans_model_picks_from_candidate_range():
    # Two tight groups of three points each.
    group_a = np.array([_unit(f"a-{i}") for i in range(3)], dtype=np.float64)
    group_b = np.array([_unit(f"b-{i}") for i in range(3)], dtype=np.float64)
    # Push groups apart in a shared subspace by blending.
    matrix = np.vstack(
        [
            0.95 * group_a + 0.05 * group_b,
            0.95 * group_b + 0.05 * group_a,
        ]
    )
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    matrix = matrix / np.clip(norms, 1e-12, None)

    chosen_k, score, scores, labels, centroids = select_kmeans_model(matrix)
    assert chosen_k in {2, 3, 4}
    assert chosen_k in scores
    assert score == scores[chosen_k]
    assert centroids.shape == (chosen_k, EMBEDDING_DIM)
    assert labels.shape == (6,)


def test_cluster_workflow_requires_at_least_three_complete_sessions():
    tenant_id = uuid4()
    sops = [_published_sop("Refund", tenant_id) for _ in range(2)]
    embeddings = {
        sop.id: [
            models.SopStepEmbedding(
                id=uuid4(),
                sop_id=sop.id,
                step_number=1,
                embedding=_unit(f"{sop.id}-1"),
            ),
            models.SopStepEmbedding(
                id=uuid4(),
                sop_id=sop.id,
                step_number=2,
                embedding=_unit(f"{sop.id}-2"),
            ),
        ]
        for sop in sops
    }
    db = ClusterFakeDb(sops, embeddings)

    with pytest.raises(InsufficientClusterDataError):
        cluster_workflow(db, tenant_id=tenant_id, workflow_name="Refund")


def test_cluster_workflow_persists_assignments_and_step_variance(monkeypatch):
    tenant_id = uuid4()
    sops = [_published_sop("Refund", tenant_id) for _ in range(4)]

    # Two execution styles: first two share "path-a", last two share "path-b".
    embeddings = {}
    for index, sop in enumerate(sops):
        path = "path-a" if index < 2 else "path-b"
        embeddings[sop.id] = [
            models.SopStepEmbedding(
                id=uuid4(),
                sop_id=sop.id,
                step_number=1,
                embedding=_unit(f"{path}-step-1"),
            ),
            models.SopStepEmbedding(
                id=uuid4(),
                sop_id=sop.id,
                step_number=2,
                embedding=_unit(f"{path}-step-2-{index}"),
            ),
        ]

    db = ClusterFakeDb(sops, embeddings)

    # Bypass SQLAlchemy filter_by_tenant complexity in unit tests.
    monkeypatch.setattr(
        "app.workflow_clustering.filter_by_tenant",
        lambda query, model, tenant_id: query,
    )

    result = cluster_workflow(db, tenant_id=tenant_id, workflow_name="Refund")

    assert result.workflow_id == "Refund"
    assert result.session_count == 4
    assert result.chosen_k in {2, 3}
    assert str(result.chosen_k) in result.silhouette_scores
    assert result.high_variance_threshold == HIGH_VARIANCE_THRESHOLD
    assert len(result.assignments) == 4
    assert {item.step_number for item in result.step_variance} == {1, 2}
    assert db.committed is True
    assert len(db.clusters) == result.chosen_k
    assert len(db.step_variances) == 2
    assert all(cluster.chosen_k == result.chosen_k for cluster in db.clusters)


def test_cosine_distance_matches_self():
    vector = np.asarray(_unit("self"), dtype=np.float64)
    vector = vector / np.linalg.norm(vector)
    assert cosine_distance(vector, vector) == pytest.approx(0.0, abs=1e-6)


def test_min_sessions_constant():
    assert MIN_SESSIONS_FOR_CLUSTERING == 3
