from app.friction_insight import build_insight_summary, first_sentence, step_titles
from app.models import FrictionAnalysis, Sop


def test_first_sentence_truncates_after_period():
    assert (
        first_sentence("Employees struggle at approval. Later steps are fine.")
        == "Employees struggle at approval."
    )


def test_step_titles_prefer_explicit_order():
    sop = Sop(title="Demo", steps=[{"order": 1, "title": "Open"}, {"order": 2, "title": "Approve"}])
    titles = step_titles(sop)
    assert titles[1] == "Open"
    assert titles[2] == "Approve"


def test_build_insight_summary_avoids_employee_identifiers():
    analysis = FrictionAnalysis(
        overall_score=72.4,
        employee_count=12,
        highest_friction_step=2,
        status="completed",
    )
    summary = build_insight_summary(
        sop_title="Expense claim",
        analysis=analysis,
        step_titles={2: "Manager approval"},
    )
    assert "Manager approval" in summary
    assert "72" in summary
    assert "12 sessions" in summary
    assert "employee_id" not in summary.lower()
    assert "@" not in summary
