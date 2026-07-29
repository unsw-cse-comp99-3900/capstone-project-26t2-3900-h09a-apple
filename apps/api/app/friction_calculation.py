from __future__ import annotations

from collections import Counter, defaultdict
from statistics import median
from uuid import UUID

from sqlalchemy.orm import Session as DBSession

from app import models
from app.friction_model import (
    ALGORITHM_VERSION,
    FrictionScoreInput,
    average_score,
    friction_score_model,
    outlier_indexes,
)


class FrictionCalculationError(RuntimeError):
    pass


def _step_numbers(sop: models.Sop) -> list[int]:
    numbers: list[int] = []
    for index, step in enumerate(sop.steps, start=1):
        raw_number = step.get("order", index)
        try:
            number = int(raw_number)
        except (TypeError, ValueError):
            number = index
        if number >= 1 and number not in numbers:
            numbers.append(number)
    return numbers


def _latest_completion_per_employee(
    completions: list[models.WalkthroughCompletion],
) -> list[models.WalkthroughCompletion]:
    latest: dict[UUID, models.WalkthroughCompletion] = {}
    for completion in sorted(completions, key=lambda item: item.completed_at, reverse=True):
        latest.setdefault(completion.employee_id, completion)
    return list(latest.values())


def _expected_durations(
    sop: models.Sop,
    step_numbers: list[int],
    observed: dict[int, list[int]],
) -> dict[int, int]:
    expected: dict[int, int] = {}
    steps_by_number = {
        number: sop.steps[index]
        for index, number in enumerate(step_numbers)
        if index < len(sop.steps)
    }
    for number in step_numbers:
        raw_seconds = steps_by_number[number].get("time_estimate")
        try:
            milliseconds = int(float(raw_seconds) * 1000)
        except (TypeError, ValueError):
            milliseconds = 0
        if milliseconds <= 0 and observed[number]:
            milliseconds = int(median(observed[number]))
        expected[number] = max(milliseconds, 1000)
    return expected


def _sequence_deviations(sequence: list[int], step_numbers: list[int]) -> Counter[int]:
    """Attribute missing or out-of-order first visits to the affected step."""

    first_position: dict[int, int] = {}
    for position, step_number in enumerate(sequence):
        if step_number in step_numbers:
            first_position.setdefault(step_number, position)

    result: Counter[int] = Counter()
    for index, step_number in enumerate(step_numbers):
        position = first_position.get(step_number)
        if position is None:
            result[step_number] += 1
            continue
        inversion_count = sum(
            1
            for previous_step in step_numbers[:index]
            if previous_step in first_position and first_position[previous_step] > position
        )
        if inversion_count:
            result[step_number] += inversion_count
    return result


def calculate_friction_analysis(
    db: DBSession,
    analysis: models.FrictionAnalysis,
) -> models.FrictionAnalysis:
    """Calculate and persist one score per latest employee-step execution."""

    sop = (
        db.query(models.Sop)
        .filter(
            models.Sop.id == analysis.sop_id,
            models.Sop.tenant_id == analysis.tenant_id,
        )
        .one_or_none()
    )
    if sop is None:
        raise FrictionCalculationError("SOP not found")

    step_numbers = _step_numbers(sop)
    if not step_numbers:
        raise FrictionCalculationError("SOP has no valid steps")

    completions = (
        db.query(models.WalkthroughCompletion)
        .filter(
            models.WalkthroughCompletion.sop_id == analysis.sop_id,
            models.WalkthroughCompletion.tenant_id == analysis.tenant_id,
        )
        .all()
    )
    completions = _latest_completion_per_employee(completions)
    completion_ids = [completion.id for completion in completions]

    timings = []
    friction_events = []
    if completion_ids:
        timings = (
            db.query(models.WalkthroughStepTiming)
            .filter(models.WalkthroughStepTiming.completion_id.in_(completion_ids))
            .all()
        )
        friction_events = (
            db.query(models.WalkthroughFrictionEvent)
            .filter(models.WalkthroughFrictionEvent.completion_id.in_(completion_ids))
            .all()
        )

    timing_by_pair = {
        (timing.completion_id, timing.step_number): timing.duration_ms for timing in timings
    }
    observed: dict[int, list[int]] = defaultdict(list)
    for timing in timings:
        if timing.step_number in step_numbers:
            observed[timing.step_number].append(timing.duration_ms)
    expected = _expected_durations(sop, step_numbers, observed)

    deviations: Counter[tuple[UUID, int]] = Counter(
        (event.completion_id, event.step_number) for event in friction_events
    )

    score_rows: list[models.FrictionEmployeeStepScore] = []
    rows_by_step: dict[int, list[models.FrictionEmployeeStepScore]] = defaultdict(list)
    for completion in completions:
        sequence_counts = Counter(completion.step_sequence or [])
        sequence_deviations = _sequence_deviations(completion.step_sequence or [], step_numbers)
        for step_number in step_numbers:
            duration = timing_by_pair.get((completion.id, step_number))
            missing_timing = duration is None
            if missing_timing:
                duration = expected[step_number] * 2
            retry_count = max(0, sequence_counts[step_number] - 1)
            deviation_count = (
                deviations[(completion.id, step_number)]
                + sequence_deviations[step_number]
                + int(missing_timing)
            )
            score = friction_score_model(
                FrictionScoreInput(
                    duration_ms=duration,
                    expected_duration_ms=expected[step_number],
                    retry_count=retry_count,
                    path_deviation_count=deviation_count,
                )
            )
            row = models.FrictionEmployeeStepScore(
                analysis_id=analysis.id,
                employee_id=completion.employee_id,
                completion_id=completion.id,
                step_number=step_number,
                duration_ms=duration,
                expected_duration_ms=expected[step_number],
                retry_count=retry_count,
                path_deviation_count=deviation_count,
                score=score,
            )
            score_rows.append(row)
            rows_by_step[step_number].append(row)

    aggregate_rows: list[models.FrictionStepAggregate] = []
    for step_number, rows in rows_by_step.items():
        scores = [float(row.score) for row in rows]
        for index in outlier_indexes(scores):
            rows[index].is_outlier = True
        best = min(rows, key=lambda row: (float(row.score), str(row.employee_id)))
        worst = max(rows, key=lambda row: (float(row.score), str(row.employee_id)))
        aggregate_rows.append(
            models.FrictionStepAggregate(
                analysis_id=analysis.id,
                step_number=step_number,
                average_score=average_score(scores),
                min_score=float(best.score),
                max_score=float(worst.score),
                best_employee_id=best.employee_id,
                worst_employee_id=worst.employee_id,
                sample_size=len(rows),
            )
        )

    db.query(models.FrictionEmployeeStepScore).filter(
        models.FrictionEmployeeStepScore.analysis_id == analysis.id
    ).delete(synchronize_session=False)
    db.query(models.FrictionStepAggregate).filter(
        models.FrictionStepAggregate.analysis_id == analysis.id
    ).delete(synchronize_session=False)
    db.add_all(score_rows)
    db.add_all(aggregate_rows)

    analysis.employee_count = len(completions)
    analysis.overall_score = average_score([float(row.score) for row in score_rows])
    analysis.highest_friction_step = (
        max(
            aggregate_rows,
            key=lambda row: (float(row.average_score), -row.step_number),
        ).step_number
        if aggregate_rows
        else None
    )
    analysis.algorithm_version = ALGORITHM_VERSION
    return analysis


__all__ = ["FrictionCalculationError", "calculate_friction_analysis"]
