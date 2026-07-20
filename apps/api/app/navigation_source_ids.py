"""Preserve machine navigation facts across LLM step grouping.

``expected_url`` (and similar destination fields) are derived later from
``source_event_ids`` by looking up the event table. The LLM must not invent
URLs, but it also must not drop NAVIGATION (or tab_switch) event ids when it
merges a click and its resulting navigation into one human-readable step.
"""

from __future__ import annotations

from typing import Any, Protocol

from app.models import EventType
from app.sop_schema import SopPayload, SopStep

# Shared prompt fragment for Anthropic and OpenAI SOP providers.
NAVIGATION_SOURCE_EVENT_ID_RULE = """
Machine navigation facts must survive step grouping:
- Every NAVIGATION event's id must appear in at least one step's source_event_ids.
- You may still merge a click and the navigation it triggers into one
  human-readable step, but that step (or another step) must keep the
  NAVIGATION event's id. Do not orphan a NAVIGATION id by citing only the click.
- Apply the same rule to tab_switch events: their ids must appear in at least
  one step's source_event_ids.
- Do not invent source_event_ids. Only use ids present in the session payload.
"""

MACHINE_NAVIGATION_TYPES = frozenset(
    {
        EventType.navigation.value,
        EventType.tab_switch.value,
    }
)


class _SessionEvent(Protocol):
    id: Any
    seq: Any
    type: Any


def _event_id_str(event: _SessionEvent) -> str:
    return str(event.id)


def _step_source_ids(step: SopStep | dict) -> list[str]:
    if isinstance(step, SopStep):
        return list(step.source_event_ids)
    raw = step.get("source_event_ids", [])
    if not isinstance(raw, list):
        return []
    return [str(event_id) for event_id in raw]


def _with_source_ids(step: SopStep | dict, source_event_ids: list[str]) -> SopStep | dict:
    if isinstance(step, SopStep):
        return step.model_copy(update={"source_event_ids": source_event_ids})
    updated = dict(step)
    updated["source_event_ids"] = source_event_ids
    return updated


def repair_orphaned_navigation_source_event_ids(
    steps: list[SopStep] | list[dict],
    events: list[_SessionEvent],
) -> list[SopStep] | list[dict]:
    """Attach orphaned navigation event ids to the nearest adjacent step.

    For each NAVIGATION/tab_switch event whose id is missing from every step's
    ``source_event_ids``, attach it to the step that already cites the
    immediately preceding session event, else the immediately following one.
    If neither neighbor is cited, attach to the step whose cited events are
    closest in ``seq`` order.
    """
    if not steps or not events:
        return steps

    ordered = sorted(events, key=lambda event: int(getattr(event, "seq", 0) or 0))
    id_to_seq = {_event_id_str(event): int(getattr(event, "seq", 0) or 0) for event in ordered}
    seq_to_id = {int(getattr(event, "seq", 0) or 0): _event_id_str(event) for event in ordered}
    sorted_seqs = sorted(seq_to_id)

    cited: set[str] = set()
    for step in steps:
        cited.update(_step_source_ids(step))

    orphaned = [
        event
        for event in ordered
        if getattr(event, "type", None) in MACHINE_NAVIGATION_TYPES
        and _event_id_str(event) not in cited
    ]
    if not orphaned:
        return steps

    repaired: list[SopStep] | list[dict] = list(steps)

    for orphan in orphaned:
        orphan_id = _event_id_str(orphan)
        orphan_seq = int(getattr(orphan, "seq", 0) or 0)

        # Prefer the step that already holds the immediate previous event.
        prev_id = None
        next_id = None
        for seq in reversed(sorted_seqs):
            if seq < orphan_seq:
                prev_id = seq_to_id[seq]
                break
        for seq in sorted_seqs:
            if seq > orphan_seq:
                next_id = seq_to_id[seq]
                break

        target_index = _find_step_index_for_event_id(repaired, prev_id)
        if target_index is None:
            target_index = _find_step_index_for_event_id(repaired, next_id)
        if target_index is None:
            target_index = _find_nearest_step_index(repaired, orphan_seq, id_to_seq)
        if target_index is None:
            continue

        existing = _step_source_ids(repaired[target_index])
        if orphan_id in existing:
            continue
        repaired[target_index] = _with_source_ids(repaired[target_index], [*existing, orphan_id])

    return repaired


def repair_sop_payload_navigation_source_event_ids(
    payload: SopPayload,
    events: list[_SessionEvent],
) -> SopPayload:
    repaired_steps = repair_orphaned_navigation_source_event_ids(payload.steps, events)
    return payload.model_copy(update={"steps": repaired_steps})


def _find_step_index_for_event_id(
    steps: list[SopStep] | list[dict],
    event_id: str | None,
) -> int | None:
    if event_id is None:
        return None
    for index, step in enumerate(steps):
        if event_id in _step_source_ids(step):
            return index
    return None


def _find_nearest_step_index(
    steps: list[SopStep] | list[dict],
    orphan_seq: int,
    id_to_seq: dict[str, int],
) -> int | None:
    best_index: int | None = None
    best_distance: int | None = None

    for index, step in enumerate(steps):
        seqs = [id_to_seq[event_id] for event_id in _step_source_ids(step) if event_id in id_to_seq]
        if not seqs:
            continue
        distance = min(abs(seq - orphan_seq) for seq in seqs)
        if best_distance is None or distance < best_distance:
            best_distance = distance
            best_index = index

    if best_index is not None:
        return best_index
    return 0 if steps else None
