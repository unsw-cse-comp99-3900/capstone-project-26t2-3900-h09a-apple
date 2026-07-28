from __future__ import annotations

import time
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import UUID

import numpy as np
import pytest

from app import models
from app.analytics_clustering import (
    ALGORITHM_VERSION,
    DEFAULT_CLUSTER_COUNT,
    DEFAULT_MIN_SESSIONS,
    FRICTION_TYPES,
    FeatureMatrix,
    InsufficientAnalyticsDataError,
    WalkthroughSessionData,
    build_feature_matrix,
    cluster_feature_matrix,
    load_walkthrough_sessions,
)


def _session(
    number: int,
    *,
    durations: dict[int, int] | None = None,
    friction: dict[tuple[int, str], int] | None = None,
    total_duration_ms: int = 10_000,
    sequence: list[int] | None = None,
    role: str = models.UserRole.employee.value,
    account_age_days: float = 0,
) -> WalkthroughSessionData:
    return WalkthroughSessionData(
        session_id=UUID(int=number + 1),
        employee_id=UUID(int=10_000 + number),
        total_duration_ms=total_duration_ms,
        step_durations_ms=durations or {},
        friction_counts=friction or {},
        step_sequence=sequence or [],
        user_role=role,
        account_age_days=account_age_days,
    )


def test_feature_extraction_is_deterministic_and_includes_all_signals():
    session = _session(
        1,
        durations={1: 1200, 3: 800},
        friction={(1, "wrong_target"): 2, (3, "selector_miss"): 1},
        total_duration_ms=5000,
        sequence=[1, 2, 1, 2, 3],
        role=models.UserRole.reviewer.value,
        account_age_days=30,
    )

    result = build_feature_matrix([session], [3, 1, 2])

    assert result.feature_names[:9] == [
        "step_1_duration_ms",
        "step_1_completed",
        "step_1_in_order",
        "step_1_first_visit_position",
        "step_1_visit_count",
        "step_1_friction_wrong_target",
        "step_1_friction_wrong_page",
        "step_1_friction_empty_input",
        "step_1_friction_selector_miss",
    ]
    assert result.feature_names[-9:] == [
        "total_duration_ms",
        "completion_ratio",
        "sequence_length",
        "backtrack_count",
        "skip_count",
        "role_employee",
        "role_reviewer",
        "role_manager",
        "account_age_days",
    ]
    assert len(result.feature_names) == 3 * (5 + len(FRICTION_TYPES)) + 9
    values = dict(zip(result.feature_names, result.values[0], strict=True))
    assert values["step_1_duration_ms"] == 1200
    assert values["step_1_completed"] == 1
    assert values["step_1_in_order"] == 1
    assert values["step_1_first_visit_position"] == pytest.approx(1 / 5)
    assert values["step_1_visit_count"] == 2
    assert values["step_2_visit_count"] == 2
    assert values["step_2_completed"] == 0
    assert values["step_3_completed"] == 1
    assert values["step_3_in_order"] == 0
    assert values["step_1_friction_wrong_target"] == 2
    assert values["step_3_friction_selector_miss"] == 1
    assert values["completion_ratio"] == pytest.approx(2 / 3)
    assert values["sequence_length"] == 5
    assert values["backtrack_count"] == 1
    assert values["skip_count"] == 0
    assert values["role_employee"] == 0
    assert values["role_reviewer"] == 1
    assert values["role_manager"] == 0
    assert values["account_age_days"] == 30
    assert ALGORITHM_VERSION == "walkthrough-kmeans-v2"


class _RowsQuery:
    def __init__(self, rows):
        self.rows = rows

    def filter(self, *criteria):
        return self

    def order_by(self, *columns):
        return self

    def one_or_none(self):
        return self.rows[0] if self.rows else None

    def all(self):
        return self.rows


class _AnalyticsDb:
    def __init__(self, rows_by_model):
        self.rows_by_model = rows_by_model

    def query(self, model):
        return _RowsQuery(self.rows_by_model.get(model, []))


def test_session_loading_uses_user_metadata_and_historical_sequence_fallback():
    tenant_id = UUID(int=100)
    workflow_id = UUID(int=101)
    user_id = UUID(int=102)
    completion_time = datetime(2026, 7, 28, tzinfo=UTC)
    first_id = UUID(int=103)
    legacy_id = UUID(int=104)
    db = _AnalyticsDb(
        {
            models.Sop: [
                SimpleNamespace(
                    id=workflow_id,
                    tenant_id=tenant_id,
                    steps=[{"order": 1}, {"order": 2}, {"order": 3}],
                )
            ],
            models.WalkthroughCompletion: [
                SimpleNamespace(
                    id=first_id,
                    employee_id=user_id,
                    duration_seconds=5,
                    completed_at=completion_time,
                    step_sequence=[1, 2, 1, 2, 3],
                    user_role=models.UserRole.reviewer.value,
                ),
                SimpleNamespace(
                    id=legacy_id,
                    employee_id=user_id,
                    duration_seconds=4,
                    completed_at=completion_time,
                    step_sequence=[],
                ),
            ],
            models.User: [
                SimpleNamespace(
                    id=user_id,
                    tenant_id=tenant_id,
                    role=models.UserRole.manager,
                    created_at=completion_time - timedelta(days=45),
                )
            ],
            models.WalkthroughStepTiming: [
                SimpleNamespace(completion_id=first_id, step_number=1, duration_ms=100),
                SimpleNamespace(completion_id=legacy_id, step_number=2, duration_ms=200),
                SimpleNamespace(completion_id=legacy_id, step_number=1, duration_ms=100),
            ],
            models.WalkthroughFrictionEvent: [],
        }
    )

    sessions, step_numbers = load_walkthrough_sessions(
        db, tenant_id=tenant_id, workflow_id=workflow_id
    )

    assert step_numbers == [1, 2, 3]
    assert sessions[0].step_sequence == [1, 2, 1, 2, 3]
    assert sessions[1].step_sequence == [1, 2]
    assert sessions[0].user_role == models.UserRole.reviewer.value
    assert sessions[1].user_role == models.UserRole.employee.value
    assert sessions[0].account_age_days == 45


def test_skip_count_uses_canonical_indexes_for_non_contiguous_steps():
    features = build_feature_matrix(
        [_session(1, durations={10: 100, 30: 100}, sequence=[10, 30, 20])],
        [10, 20, 30],
    )
    values = dict(zip(features.feature_names, features.values[0], strict=True))

    assert values["backtrack_count"] == 1
    assert values["skip_count"] == 1


def test_reverse_moves_only_increment_backtracks_and_unknown_steps_are_ignored():
    features = build_feature_matrix(
        [_session(1, sequence=[30, 999, 10])],
        [10, 20, 30],
    )
    values = dict(zip(features.feature_names, features.values[0], strict=True))

    assert values["sequence_length"] == 2
    assert values["backtrack_count"] == 1
    assert values["skip_count"] == 0
    assert values["step_10_first_visit_position"] == 1


def test_clustering_is_reproducible():
    sessions = [
        _session(
            index,
            durations={1: 100 + group * 1000 + index, 2: 200 + group * 500},
            total_duration_ms=1000 + group * 5000 + index,
        )
        for index in range(18)
        for group in [index // 6]
    ]
    features = build_feature_matrix(sessions, [1, 2])

    first = cluster_feature_matrix(features)
    second = cluster_feature_matrix(features)

    assert DEFAULT_CLUSTER_COUNT == 3
    assert [item.cluster_id for item in first[1]] == [item.cluster_id for item in second[1]]
    assert [item.centroid_values for item in first[0]] == [
        item.centroid_values for item in second[0]
    ]
    assert first[3] == pytest.approx(second[3])


def test_boundary_validation_rejects_too_few_distinct_patterns():
    features = build_feature_matrix(
        [_session(index, durations={1: 100}) for index in range(5)],
        [1],
    )

    with pytest.raises(ValueError, match="between 2 and 4"):
        cluster_feature_matrix(features, k=1)
    with pytest.raises(ValueError, match="between 2 and 4"):
        cluster_feature_matrix(features, k=5)
    with pytest.raises(InsufficientAnalyticsDataError):
        cluster_feature_matrix(
            FeatureMatrix(
                values=features.values[:4],
                feature_names=features.feature_names,
                sessions=features.sessions[:4],
            )
        )

    assert DEFAULT_MIN_SESSIONS == 5
    with pytest.raises(
        InsufficientAnalyticsDataError,
        match="at least 3 distinct execution patterns",
    ):
        cluster_feature_matrix(features)


def test_outlier_uses_mean_plus_two_standard_deviations_and_reports_reason():
    values = np.asarray([[0.0]] * 20 + [[10.0]] * 20 + [[3.0]], dtype=np.float64)
    sessions = [_session(index) for index in range(len(values))]
    features = FeatureMatrix(values=values, feature_names=["unusual_feature"], sessions=sessions)

    _, assignments, outliers, _ = cluster_feature_matrix(features, k=2)

    assert len(outliers) == 1
    assert outliers[0].session_id == str(sessions[-1].session_id)
    assert outliers[0].deviating_feature == "unusual_feature"
    assert outliers[0].feature_value == 3
    assert outliers[0].deviation == pytest.approx(
        outliers[0].feature_value - outliers[0].centroid_value
    )
    assert "standard deviations" in outliers[0].reason
    distances = np.asarray([item.distance_to_center for item in assignments])
    assert outliers[0].threshold == pytest.approx(float(np.mean(distances) + 2 * np.std(distances)))


def test_one_hundred_sessions_complete_well_under_thirty_seconds():
    sessions = [
        _session(
            index,
            durations={step: 100 * step + (index % 4) * 1000 + index for step in range(1, 9)},
            friction={
                (step, FRICTION_TYPES[(index + step) % len(FRICTION_TYPES)]): index % 3
                for step in range(1, 9)
            },
            total_duration_ms=10_000 + (index % 4) * 5000 + index,
        )
        for index in range(100)
    ]

    started = time.perf_counter()
    features = build_feature_matrix(sessions, range(1, 9))
    clusters, assignments, _, _ = cluster_feature_matrix(features)
    elapsed = time.perf_counter() - started

    assert len(clusters) == 3
    assert len(assignments) == 100
    assert elapsed < 30
