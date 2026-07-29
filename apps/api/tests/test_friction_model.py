from time import perf_counter

import pytest

from app.friction_model import (
    FrictionScoreInput,
    average_score,
    friction_score_model,
    outlier_indexes,
)


def _score(duration: int, retries: int = 0, deviations: int = 0) -> float:
    return friction_score_model(
        FrictionScoreInput(
            duration_ms=duration,
            expected_duration_ms=10_000,
            retry_count=retries,
            path_deviation_count=deviations,
        )
    )


def test_clean_execution_scores_zero():
    assert _score(5_000) == 0


def test_score_is_bounded_and_increases_with_friction():
    clean = _score(7_500)
    slow = _score(15_000)
    retried = _score(15_000, retries=2)
    deviated = _score(15_000, retries=2, deviations=4)

    assert 0 <= clean < slow < retried < deviated <= 100
    assert _score(100_000, retries=100, deviations=100) == 100


@pytest.mark.parametrize(
    "metrics",
    [
        FrictionScoreInput(-1, 1_000, 0, 0),
        FrictionScoreInput(1_000, 0, 0, 0),
        FrictionScoreInput(1_000, 1_000, -1, 0),
        FrictionScoreInput(1_000, 1_000, 0, -1),
    ],
)
def test_invalid_metrics_are_rejected(metrics):
    with pytest.raises(ValueError):
        friction_score_model(metrics)


def test_high_iqr_outlier_is_identified():
    assert outlier_indexes([10, 11, 12, 13, 90]) == {4}
    assert outlier_indexes([10, 20, 100]) == set()


def test_fifty_employee_dataset_completes_well_inside_sla():
    started = perf_counter()
    employee_scores = [
        _score(5_000 + employee * 250, retries=employee % 3, deviations=employee % 2)
        for employee in range(50)
    ]

    assert len(employee_scores) == 50
    assert min(employee_scores) == employee_scores[0]
    assert max(employee_scores) <= 100
    assert 0 <= average_score(employee_scores) <= 100
    assert perf_counter() - started < 1
