from datetime import UTC, datetime, timedelta
from uuid import uuid4

from app import models
from app.friction_calculation import _sequence_deviations, calculate_friction_analysis


class FakeQuery:
    def __init__(self, rows):
        self.rows = rows

    def filter(self, *_criteria):
        return self

    def one_or_none(self):
        return self.rows[0] if self.rows else None

    def all(self):
        return list(self.rows)

    def delete(self, synchronize_session=False):
        self.rows.clear()
        return 0


class FakeDb:
    def __init__(self, rows):
        self.rows = rows
        self.added = []

    def query(self, model):
        return FakeQuery(self.rows.setdefault(model, []))

    def add_all(self, rows):
        self.added.extend(rows)


def test_sequence_deviations_distinguish_retries_from_path_changes():
    assert _sequence_deviations([1, 2, 1, 2, 3], [1, 2, 3]) == {}
    assert _sequence_deviations([2, 1, 3], [1, 2, 3]) == {2: 1}
    assert _sequence_deviations([1, 3], [1, 2, 3]) == {2: 1}


def test_calculation_builds_scores_and_aggregates_for_fifty_employees():
    tenant_id = uuid4()
    sop_id = uuid4()
    analysis = models.FrictionAnalysis(id=uuid4(), tenant_id=tenant_id, sop_id=sop_id)
    sop = models.Sop(
        id=sop_id,
        tenant_id=tenant_id,
        session_id=uuid4(),
        title="Expense claim",
        steps=[
            {"order": 1, "title": "Open form", "time_estimate": 10},
            {"order": 2, "title": "Submit form", "time_estimate": 20},
        ],
        warnings=[],
    )
    now = datetime.now(UTC)
    completions = []
    timings = []
    friction_events = []
    employee_ids = []
    for index in range(50):
        employee_id = uuid4()
        employee_ids.append(employee_id)
        completion = models.WalkthroughCompletion(
            id=uuid4(),
            tenant_id=tenant_id,
            sop_id=sop_id,
            employee_id=employee_id,
            completed_at=now + timedelta(seconds=index),
            duration_seconds=30 + index,
            step_sequence=[1, 2] + ([2] if index % 5 == 0 else []),
        )
        completions.append(completion)
        timings.extend(
            [
                models.WalkthroughStepTiming(
                    id=uuid4(),
                    completion_id=completion.id,
                    step_number=1,
                    duration_ms=6_000 + (index * 100),
                ),
                models.WalkthroughStepTiming(
                    id=uuid4(),
                    completion_id=completion.id,
                    step_number=2,
                    duration_ms=18_000 + (index * 500),
                ),
            ]
        )
        if index >= 40:
            friction_events.append(
                models.WalkthroughFrictionEvent(
                    id=uuid4(),
                    completion_id=completion.id,
                    step_number=2,
                    event_type=models.WalkthroughFrictionType.selector_miss.value,
                    occurred_at=now,
                )
            )

    db = FakeDb(
        {
            models.Sop: [sop],
            models.WalkthroughCompletion: completions,
            models.WalkthroughStepTiming: timings,
            models.WalkthroughFrictionEvent: friction_events,
            models.FrictionEmployeeStepScore: [],
            models.FrictionStepAggregate: [],
        }
    )

    result = calculate_friction_analysis(db, analysis)
    scores = [row for row in db.added if isinstance(row, models.FrictionEmployeeStepScore)]
    aggregates = [row for row in db.added if isinstance(row, models.FrictionStepAggregate)]

    assert result.employee_count == 50
    assert len(scores) == 100
    assert len(aggregates) == 2
    assert result.highest_friction_step == 2
    assert aggregates[0].sample_size == 50
    assert aggregates[0].best_employee_id == employee_ids[0]
    assert 0 <= float(result.overall_score) <= 100
