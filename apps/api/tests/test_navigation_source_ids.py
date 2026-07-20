from types import SimpleNamespace
from uuid import UUID

from app.anthropic_sop_provider import build_sop_prompt as build_anthropic_prompt
from app.navigation_source_ids import (
    NAVIGATION_SOURCE_EVENT_ID_RULE,
    repair_orphaned_navigation_source_event_ids,
    repair_sop_payload_navigation_source_event_ids,
)
from app.openai_sop_provider import build_sop_prompt as build_openai_prompt
from app.sop_schema import SopPayload, SopStep
from app.sop_service import build_walkthrough_payload

SESSION_ID = UUID("cccccccc-cccc-cccc-cccc-cccccccccccc")
TENANT_ID = UUID("11111111-1111-1111-1111-111111111111")


def _click_then_navigation_events():
    # Mirror the failing GitHub case: the click event has no destination URL;
    # only the NAVIGATION event carries the page the walkthrough must open.
    return [
        SimpleNamespace(
            id=1,
            seq=1,
            type="click",
            target_label="Insights",
            target_selector="a[href='/pulse']",
            url=None,
            attrs={},
            screenshot_id=None,
            timestamp_ms=1_000,
            session_id=SESSION_ID,
        ),
        SimpleNamespace(
            id=2,
            seq=2,
            type="navigation",
            target_label=None,
            target_selector=None,
            url="https://github.com/org/repo/pulse",
            attrs={"page_title": "Pulse"},
            screenshot_id=None,
            timestamp_ms=1_200,
            session_id=SESSION_ID,
        ),
    ]


def test_openai_and_anthropic_prompts_require_navigation_source_ids():
    session_payload = {"workflow_name": "Insights", "events": [{"id": "1"}, {"id": "2"}]}

    openai_prompt = build_openai_prompt(session_payload)
    anthropic_prompt = build_anthropic_prompt(session_payload)

    assert "Every NAVIGATION event's id must appear" in NAVIGATION_SOURCE_EVENT_ID_RULE
    assert NAVIGATION_SOURCE_EVENT_ID_RULE in openai_prompt
    assert NAVIGATION_SOURCE_EVENT_ID_RULE in anthropic_prompt


def test_repair_attaches_orphaned_navigation_id_to_preceding_click_step():
    events = _click_then_navigation_events()
    steps = [
        SopStep(
            order=1,
            title="Open Insights",
            instruction="Click Insights.",
            source_event_ids=["1"],
        )
    ]

    repaired = repair_orphaned_navigation_source_event_ids(steps, events)

    assert repaired[0].source_event_ids == ["1", "2"]


def test_repair_is_noop_when_navigation_id_already_cited():
    events = _click_then_navigation_events()
    steps = [
        SopStep(
            order=1,
            title="Open Insights",
            instruction="Click Insights.",
            source_event_ids=["1", "2"],
        )
    ]

    repaired = repair_orphaned_navigation_source_event_ids(steps, events)

    assert repaired[0].source_event_ids == ["1", "2"]


def test_repair_keeps_separate_steps_when_navigation_has_its_own_step():
    events = _click_then_navigation_events()
    steps = [
        SopStep(
            order=1,
            title="Click Insights",
            instruction="Click Insights.",
            source_event_ids=["1"],
        ),
        SopStep(
            order=2,
            title="Open Pulse",
            instruction="Open the Pulse page.",
            source_event_ids=["2"],
        ),
    ]

    repaired = repair_orphaned_navigation_source_event_ids(steps, events)

    assert repaired[0].source_event_ids == ["1"]
    assert repaired[1].source_event_ids == ["2"]


def test_repair_sop_payload_restores_orphaned_navigation_id():
    events = _click_then_navigation_events()
    payload = SopPayload(
        title="Insights flow",
        summary="One step",
        steps=[
            SopStep(
                order=1,
                title="Open Insights",
                instruction="Click Insights.",
                source_event_ids=["1"],
            )
        ],
    )

    repaired = repair_sop_payload_navigation_source_event_ids(payload, events)

    assert repaired.steps[0].source_event_ids == ["1", "2"]


class _WalkthroughDb:
    def __init__(self, events):
        self.events = events
        self.current_model = None
        self._event_ids_filter = None
        self._session_id_filter = None

    def query(self, model):
        self.current_model = model
        self._event_ids_filter = None
        self._session_id_filter = None
        return self

    def join(self, *args):
        return self

    def filter(self, *args):
        for criterion in args:
            left = getattr(criterion, "left", None)
            right = getattr(criterion, "right", None)
            operator = getattr(criterion, "operator", None)
            if left is not None and getattr(left, "key", None) == "session_id":
                self._session_id_filter = getattr(right, "value", right)
            if operator is not None and operator.__name__ == "in_op":
                values = getattr(right, "value", right)
                if values is not None:
                    self._event_ids_filter = set(values)
        return self

    def order_by(self, *args):
        return self

    def all(self):
        from app import models

        if self.current_model != models.Event:
            return []
        events = self.events
        if self._session_id_filter is not None:
            events = [
                event
                for event in events
                if getattr(event, "session_id", self._session_id_filter) == self._session_id_filter
            ]
        if self._event_ids_filter is not None:
            events = [event for event in events if event.id in self._event_ids_filter]
        return events

    def first(self):
        return None


def test_walkthrough_expected_url_non_null_after_repair_when_llm_drops_navigation_id():
    events = _click_then_navigation_events()
    sop = SimpleNamespace(
        session_id=SESSION_ID,
        tenant_id=TENANT_ID,
        steps=[
            {
                "order": 1,
                "title": "Open Insights",
                "instruction": "Click Insights.",
                # LLM grouped click+nav but only cited the click id.
                "source_event_ids": ["1"],
            }
        ],
    )

    payload = build_walkthrough_payload(sop, _WalkthroughDb(events))

    assert payload.steps[0].expected_url == "https://github.com/org/repo/pulse"


def test_walkthrough_expected_url_non_null_when_llm_keeps_both_ids():
    events = _click_then_navigation_events()
    sop = SimpleNamespace(
        session_id=SESSION_ID,
        tenant_id=TENANT_ID,
        steps=[
            {
                "order": 1,
                "title": "Open Insights",
                "instruction": "Click Insights.",
                "source_event_ids": ["1", "2"],
            }
        ],
    )

    payload = build_walkthrough_payload(sop, _WalkthroughDb(events))

    assert payload.steps[0].expected_url == "https://github.com/org/repo/pulse"
