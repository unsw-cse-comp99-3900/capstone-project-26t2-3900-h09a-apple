"""Deterministic per-step friction scoring (versioned weights).

Higher score means more friction. Weights are fixed at 60% time / 25% retries /
15% path deviation so historical analyses stay comparable across releases.
"""

from __future__ import annotations

from dataclasses import dataclass
from statistics import mean

# Bump when weight formula or clamps change; stored on FrictionAnalysis rows.
ALGORITHM_VERSION = "friction-v1"


@dataclass(frozen=True)
class FrictionScoreInput:
    duration_ms: int
    expected_duration_ms: int
    retry_count: int
    path_deviation_count: int


def _clamp(value: float, minimum: float = 0.0, maximum: float = 100.0) -> float:
    return min(maximum, max(minimum, value))


def friction_score_model(metrics: FrictionScoreInput) -> float:
    """Return a deterministic 0-100 score where higher means more friction.

    Time contributes 60%, retries 25%, and observed path deviations 15%.
    Half the expected time maps to zero time friction and twice the expected
    time saturates that component. This leaves room for a clean execution to
    score near zero while bounding unusually slow or noisy runs.
    """

    if metrics.duration_ms < 0:
        raise ValueError("duration_ms must be non-negative")
    if metrics.expected_duration_ms <= 0:
        raise ValueError("expected_duration_ms must be positive")
    if metrics.retry_count < 0 or metrics.path_deviation_count < 0:
        raise ValueError("retry and path deviation counts must be non-negative")

    duration_ratio = metrics.duration_ms / metrics.expected_duration_ms
    time_score = _clamp(((duration_ratio - 0.5) / 1.5) * 100)
    retry_score = _clamp(metrics.retry_count * 35.0)
    deviation_score = _clamp(metrics.path_deviation_count * 25.0)
    return round((time_score * 0.60) + (retry_score * 0.25) + (deviation_score * 0.15), 2)


def percentile(values: list[float], fraction: float) -> float:
    """Linear-interpolated percentile for IQR outlier fences."""
    if not values:
        raise ValueError("values must not be empty")
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    weight = position - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def outlier_indexes(scores: list[float]) -> set[int]:
    """Detect high-friction IQR outliers; small samples are not classified."""

    if len(scores) < 4:
        return set()
    q1 = percentile(scores, 0.25)
    q3 = percentile(scores, 0.75)
    upper_fence = q3 + (1.5 * (q3 - q1))
    return {index for index, score in enumerate(scores) if score > upper_fence}


def average_score(scores: list[float]) -> float:
    """Rounded mean score, or 0.0 when the list is empty."""
    return round(mean(scores), 2) if scores else 0.0
