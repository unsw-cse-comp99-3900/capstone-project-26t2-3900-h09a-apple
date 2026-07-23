from types import SimpleNamespace

from app.sop_event_normalizer import (
    MAX_LABEL_LENGTH,
    MAX_VALUE_LENGTH,
    normalize_session_events,
)


def event(
    event_id,
    seq,
    event_type,
    timestamp_ms,
    *,
    label="Prompt",
    value=None,
    app="Claude",
    window="Claude",
    attrs=None,
):
    event_attrs = {
        "foreground_app": app,
        "window_title": window,
        "raw_event_type": "key_activity",
        "desktop_target": {
            "control_type": "Edit",
            "automation_id": "prompt-input",
        },
    }
    if attrs:
        event_attrs.update(attrs)

    return SimpleNamespace(
        id=event_id,
        seq=seq,
        type=event_type,
        timestamp_ms=timestamp_ms,
        target_label=label,
        target_selector="uia://automation-id/prompt-input",
        value=value,
        url=None,
        screenshot_id=None,
        attrs=event_attrs,
    )


def test_click_input_and_submit_become_one_semantic_action():
    actions = normalize_session_events(
        [
            event(1, 0, "click", 1_000),
            event(2, 1, "input", 1_100, value="h"),
            event(3, 2, "input", 1_200, value="hello"),
            event(4, 3, "submit", 1_300, value="hello"),
        ]
    )

    assert len(actions) == 1
    assert actions[0]["action_type"] == "input_and_submit"
    assert actions[0]["source_event_ids"] == ["1", "2", "3", "4"]
    assert actions[0]["input_values"] == ["hello"]
    assert actions[0]["event_type_counts"] == {
        "click": 1,
        "input": 2,
        "submit": 1,
    }


def test_progressive_input_snapshots_keep_only_final_value():
    input_events = [
        event(index, index, "input", 1_000 + index, value="agent"[:index])
        for index in range(1, 6)
    ]

    actions = normalize_session_events(input_events)

    assert len(actions) == 1
    assert actions[0]["action_type"] == "input"
    assert actions[0]["input_values"] == ["agent"]
    assert actions[0]["event_count"] == 5


def test_password_values_and_identity_are_removed_defensively():
    password_event = event(
        1,
        0,
        "input",
        1_000,
        label="Password",
        value="super-secret",
        attrs={
            "is_password": True,
            "desktop_target": {
                "control_type": "Edit",
                "automation_id": "password",
                "is_password": True,
            },
        },
    )

    action = normalize_session_events([password_event])[0]

    assert "input_values" not in action
    assert action["targets"] == [{"control_type": "Edit"}]


def test_repeated_clicks_are_grouped():
    actions = normalize_session_events(
        [
            event(1, 0, "click", 1_000, label="New chat"),
            event(2, 1, "click", 1_300, label="New chat"),
            event(3, 2, "click", 1_600, label="New chat"),
        ]
    )

    assert len(actions) == 1
    assert actions[0]["action_type"] == "repeated_click"
    assert actions[0]["source_event_ids"] == ["1", "2", "3"]


def test_internal_generic_structural_clicks_are_removed():
    actions = normalize_session_events(
        [
            event(1, 0, "click", 1_000, label="New chat"),
            event(2, 1, "click", 7_000, label="Main"),
            event(3, 2, "click", 13_000, label="Prompt"),
        ]
    )

    assert len(actions) == 2
    assert [action["source_event_ids"] for action in actions] == [["1"], ["3"]]


def test_context_changes_start_new_action_groups():
    actions = normalize_session_events(
        [
            event(1, 0, "click", 1_000, app="Claude", window="Claude"),
            event(2, 1, "click", 1_100, app="Code", window="agent.ts"),
        ]
    )

    assert len(actions) == 2
    assert actions[0]["application"] == "Claude"
    assert actions[1]["application"] == "Code"


def test_labels_and_values_are_bounded_before_reaching_the_llm():
    action = normalize_session_events(
        [
            event(
                1,
                0,
                "input",
                1_000,
                label="L" * (MAX_LABEL_LENGTH + 50),
                value="V" * (MAX_VALUE_LENGTH + 50),
            )
        ]
    )[0]

    assert len(action["targets"][0]["label"]) == MAX_LABEL_LENGTH
    assert len(action["input_values"][0]) == MAX_VALUE_LENGTH
