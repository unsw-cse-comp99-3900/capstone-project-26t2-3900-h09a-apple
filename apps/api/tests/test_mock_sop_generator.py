from types import SimpleNamespace

from app.mock_sop_generator import MockSopGenerator
from app.models import EventType
from app.sop_schema import SopPayload


def test_mock_sop_generator_returns_payload_for_session():
    session = SimpleNamespace(
        workflow_name="Login Flow",
        events=[
            SimpleNamespace(
                id=1,
                seq=0,
                type=EventType.navigation,
                url="https://example.com/login",
                target_label=None,
                target_selector=None,
                value=None,
                attrs={"page_title": "Login"},
            )
        ],
    )

    generator = MockSopGenerator()
    payload = generator.generate(session)

    assert payload.title == "Login Flow"
    assert len(payload.steps) == 1
    assert payload.steps[0].order == 1
    assert payload.steps[0].time_estimate == 5


def test_generate_single_step():
    session = SimpleNamespace(
        workflow_name="Login Flow",
        events=[
            SimpleNamespace(
                id=1,
                seq=0,
                type="navigation",
                url="https://example.com/login?redirect=/dashboard",
                target_label=None,
                target_selector=None,
                attrs={"page_title": "Example Login"},
            ),
            SimpleNamespace(
                id=2,
                seq=1,
                type="input",
                url=None,
                target_label="username",
                target_selector=None,
                attrs={},
            ),
        ],
    )

    generator = MockSopGenerator()
    result = generator.generate(session)

    assert result.title == "Login Flow"
    assert len(result.steps) == 1
    assert result.steps[0].title == "Example Login"
    assert result.steps[0].instruction == ("Open Example Login.\n" "Type in the 'username' field.")
    assert result.steps[0].branch is None
    assert isinstance(result, SopPayload)


def test_generate_title_falls_back_to_action_not_raw_url():
    session = SimpleNamespace(
        workflow_name="Flow",
        events=[
            SimpleNamespace(
                id=1,
                seq=0,
                type="click",
                url="https://example.com/settings?very=long",
                target_label="Save changes",
                target_selector=None,
                attrs={},
            ),
        ],
    )

    generator = MockSopGenerator()
    result = generator.generate(session)

    assert result.steps[0].title == "Click Save changes"
    assert result.steps[0].title != "https://example.com/settings?very=long"
    assert result.steps[0].instruction == "Click 'Save changes'."


def test_navigation_title_falls_back_to_clean_url_without_query():
    session = SimpleNamespace(
        workflow_name="Flow",
        events=[
            SimpleNamespace(
                id=1,
                seq=0,
                type="navigation",
                url="https://example.com/path/to/page?token=secret#fragment",
                target_label=None,
                target_selector=None,
                attrs={},
            ),
        ],
    )

    generator = MockSopGenerator()
    result = generator.generate(session)

    assert result.steps[0].title == "example.com/path/to/page"
    assert result.steps[0].instruction == "Open example.com/path/to/page."


def test_navigation_creates_multiple_steps():
    session = SimpleNamespace(
        workflow_name="Flow",
        events=[
            SimpleNamespace(
                id=1,
                seq=0,
                type="navigation",
                url="page1",
                target_label=None,
                target_selector=None,
                attrs={},
            ),
            SimpleNamespace(
                id=2,
                seq=1,
                type="click",
                url=None,
                target_label="save",
                target_selector=None,
                attrs={},
            ),
            SimpleNamespace(
                id=3,
                seq=2,
                type="navigation",
                url="page2",
                target_label=None,
                target_selector=None,
                attrs={},
            ),
        ],
    )

    generator = MockSopGenerator()

    result = generator.generate(session)

    assert len(result.steps) == 2


def test_repeated_action_warning():
    session = SimpleNamespace(
        workflow_name="Flow",
        events=[
            SimpleNamespace(
                id=1,
                seq=0,
                type="click",
                url=None,
                target_label="save",
                target_selector=None,
                attrs={},
            ),
            SimpleNamespace(
                id=2,
                seq=1,
                type="click",
                url=None,
                target_label="save",
                target_selector=None,
                attrs={},
            ),
        ],
    )

    generator = MockSopGenerator()

    result = generator.generate(session)

    assert len(result.warnings) == 1
    assert result.warnings[0].type == "repeated_action"


def test_generate_without_navigation():
    session = SimpleNamespace(
        workflow_name="Flow",
        events=[
            SimpleNamespace(
                id=1,
                seq=0,
                type="click",
                url=None,
                target_label="save",
                target_selector=None,
                attrs={},
            ),
        ],
    )

    generator = MockSopGenerator()
    result = generator.generate(session)

    assert len(result.steps) == 1
    assert result.steps[0].title == "Click save"


def test_window_change_and_focus_instructions():
    session = SimpleNamespace(
        workflow_name="Desktop",
        events=[
            SimpleNamespace(
                id=1,
                seq=0,
                type="window_change",
                url=None,
                target_label=None,
                target_selector=None,
                attrs={"to_app": "Claude", "to_title": "Claude", "foreground_app": "Claude"},
            ),
            SimpleNamespace(
                id=2,
                seq=1,
                type="focus_change",
                url=None,
                target_label="Create project",
                target_selector=None,
                attrs={"to_name": "Create project", "foreground_app": "Claude"},
            ),
            SimpleNamespace(
                id=3,
                seq=2,
                type="scroll",
                url=None,
                target_label=None,
                target_selector=None,
                attrs={"foreground_app": "Claude", "delta_y": 3},
            ),
        ],
    )

    result = MockSopGenerator().generate(session)

    assert any(
        "Switch to" in step.instruction and "Claude" in step.instruction for step in result.steps
    )
    assert any("Create project" in step.instruction for step in result.steps)
    assert any("Scroll within Claude" in step.instruction for step in result.steps)


def test_click_without_label_includes_foreground_app():
    session = SimpleNamespace(
        workflow_name="Desktop",
        events=[
            SimpleNamespace(
                id=1,
                seq=0,
                type="click",
                url=None,
                target_label=None,
                target_selector=None,
                attrs={"foreground_app": "Claude"},
            ),
        ],
    )

    result = MockSopGenerator().generate(session)
    assert result.steps[0].instruction == ("Click the highlighted control in the Claude window.")


def test_click_uses_uia_help_text_and_role():
    session = SimpleNamespace(
        workflow_name="Desktop",
        events=[
            SimpleNamespace(
                id=1,
                seq=0,
                type="click",
                url=None,
                target_label=None,
                target_selector=None,
                attrs={
                    "foreground_app": "Claude",
                    "uia_help_text": "New chat",
                    "uia_control_type": "ControlType.Button",
                },
            ),
        ],
    )

    result = MockSopGenerator().generate(session)
    assert result.steps[0].instruction == "Click the 'New chat' button."
