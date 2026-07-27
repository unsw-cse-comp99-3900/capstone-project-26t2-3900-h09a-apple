from __future__ import annotations

import time
from uuid import UUID

import numpy as np
import pytest

from app.analytics_clustering import (
    DEFAULT_CLUSTER_COUNT,
    DEFAULT_MIN_SESSIONS,
    FRICTION_TYPES,
    FeatureMatrix,
    InsufficientAnalyticsDataError,
    WalkthroughSessionData,
    build_feature_matrix,
    cluster_feature_matrix,
)


def _session(
    number: int,
    *,
    durations: dict[int, int] | None = None,
    friction: dict[tuple[int, str], int] | None = None,
    total_duration_ms: int = 10_000,
) -> WalkthroughSessionData:
    return WalkthroughSessionData(
        session_id=UUID(int=number + 1),
        employee_id=UUID(int=10_000 + number),
        total_duration_ms=total_duration_ms,
        step_durations_ms=durations or {},
        friction_counts=friction or {},
    )


def test_feature_extraction_is_deterministic_and_includes_all_signals():
    session = _session(
        1,
        durations={1: 1200, 3: 800},
        friction={(1, "wrong_target"): 2, (3, "selector_miss"): 1},
        total_duration_ms=5000,
    )

    result = build_feature_matrix([session], [3, 1, 2])

    assert result.feature_names[:7] == [
        "step_1_duration_ms",
        "step_1_completed",
        "step_1_in_order",
        "step_1_friction_wrong_target",
        "step_1_friction_wrong_page",
        "step_1_friction_empty_input",
        "step_1_friction_selector_miss",
    ]
    assert result.feature_names[-2:] == ["total_duration_ms", "completion_ratio"]
    assert len(result.feature_names) == 3 * (3 + len(FRICTION_TYPES)) + 2
    values = dict(zip(result.feature_names, result.values[0], strict=True))
    assert values["step_1_duration_ms"] == 1200
    assert values["step_1_completed"] == 1
    assert values["step_1_in_order"] == 1
    assert values["step_2_completed"] == 0
    assert values["step_3_completed"] == 1
    assert values["step_3_in_order"] == 0
    assert values["step_1_friction_wrong_target"] == 2
    assert values["step_3_friction_selector_miss"] == 1
    assert values["completion_ratio"] == pytest.approx(2 / 3)


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
