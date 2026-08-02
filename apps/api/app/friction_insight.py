"""Deterministic executive friction insights for manager dashboards (H09AAPPLE-38)."""

from __future__ import annotations

from app import models


def step_titles(sop: models.Sop) -> dict[int, str]:
    titles: dict[int, str] = {}
    for index, step in enumerate(sop.steps or [], start=1):
        try:
            number = int(step.get("order", index))
        except (TypeError, ValueError):
            number = index
        title = step.get("title")
        titles[number] = str(title) if title else f"Step {number}"
    return titles


def step_instructions(sop: models.Sop) -> dict[int, str]:
    instructions: dict[int, str] = {}
    for index, step in enumerate(sop.steps or [], start=1):
        try:
            number = int(step.get("order", index))
        except (TypeError, ValueError):
            number = index
        instruction = step.get("instruction")
        if instruction is None:
            continue
        text = str(instruction).strip()
        if text:
            instructions[number] = text
    return instructions


def first_sentence(text: str) -> str:
    """Return the first sentence for card teasers."""
    cleaned = " ".join(text.split()).strip()
    if not cleaned:
        return ""
    for separator in (". ", "! ", "? "):
        index = cleaned.find(separator)
        if index != -1:
            return cleaned[: index + 1].strip()
    return cleaned


def build_insight_summary(
    *,
    sop_title: str,
    analysis: models.FrictionAnalysis,
    step_titles: dict[int, str],
) -> str:
    """Build a plain-English executive summary from aggregate friction stats.

    Avoids employee identifiers. Suitable as the Module 5 teaser source until a
    dedicated LLM insight pipeline lands.
    """
    score = float(analysis.overall_score) if analysis.overall_score is not None else None
    sessions = int(analysis.employee_count or 0)
    highest = analysis.highest_friction_step
    step_label = None
    if highest is not None:
        title = step_titles.get(int(highest))
        step_label = title or f"Step {int(highest)}"

    if score is None:
        return (
            f'Friction analysis for "{sop_title}" is not ready yet. '
            "Publish completions and wait for scoring to finish. "
            "Once scores land, managers can target the highest-friction steps."
        )

    if step_label is not None:
        return (
            f'"{sop_title}" shows the highest friction at {step_label}, '
            f"with an aggregate score of {score:.0f} across {sessions} sessions. "
            "Execution paths diverge most around this step and nearby hand-offs. "
            "Align SOP instructions to the faster path to cut variance."
        )

    return (
        f'"{sop_title}" has an aggregate friction score of {score:.0f} '
        f"across {sessions} sessions. "
        "Compare cluster timelines to see where paths diverge. "
        "Prioritise SOP edits on steps with the largest timing gaps."
    )


__all__ = ["build_insight_summary", "first_sentence", "step_instructions", "step_titles"]
