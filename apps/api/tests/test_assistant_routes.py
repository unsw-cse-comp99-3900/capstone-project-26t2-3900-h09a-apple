from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.assistant_routes import (
    build_walkthrough_assistant_prompt,
    parse_confidence_footer,
)
from app.assistant_schema import WalkthroughAssistantRequest


def _payload(**overrides):
    base = {
        "task": "qa",
        "question": "What should I click?",
        "mode": "walkthrough",
        "page_url": "https://example.com/app",
        "step": {
            "index": 0,
            "total": 3,
            "title": "Open form",
            "instruction": "Click Create",
        },
    }
    base.update(overrides)
    return WalkthroughAssistantRequest.model_validate(base)


def test_qa_request_requires_question():
    with pytest.raises(ValidationError):
        WalkthroughAssistantRequest.model_validate(
            {
                "task": "qa",
                "step": {
                    "index": 0,
                    "total": 1,
                    "title": "Step",
                    "instruction": "Do it",
                },
            }
        )


def test_coach_request_allows_missing_question():
    payload = _payload(task="coach", question=None)
    assert payload.task == "coach"
    assert payload.question is None


def test_build_prompt_includes_task_and_confidence_rules():
    prompt = build_walkthrough_assistant_prompt(_payload(), role="EMPLOYEE")
    assert "User question:" in prompt
    assert "What should I click?" in prompt
    assert "CONFIDENCE:" in prompt
    assert "User role: EMPLOYEE" in prompt


def test_build_prompt_for_recover_includes_targets():
    prompt = build_walkthrough_assistant_prompt(
        _payload(
            task="recover",
            question=None,
            expected_target="Submit button",
            actual_action="Clicked Settings",
        ),
        role="MANAGER",
    )
    assert "recovery path" in prompt.lower() or "off the expected" in prompt.lower()
    assert "Expected target: Submit button" in prompt
    assert "Actual action: Clicked Settings" in prompt


def test_parse_confidence_footer_strips_line():
    answer, level, reason = parse_confidence_footer(
        "Click the blue Save button next.\nCONFIDENCE: high - Save is visible on this page"
    )
    assert answer == "Click the blue Save button next."
    assert level == "high"
    assert "Save is visible" in reason


def test_parse_confidence_footer_defaults_when_missing():
    answer, level, reason = parse_confidence_footer("Just keep going.")
    assert answer == "Just keep going."
    assert level == "medium"
    assert "did not report" in reason
