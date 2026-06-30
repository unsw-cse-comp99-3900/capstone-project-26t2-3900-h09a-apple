from types import SimpleNamespace

from app.mock_sop_generator import MockSopGenerator
from app.sop_schema import SopPayload


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
    assert result.steps[0].instruction == (
        "Open Example Login.\n"
        "Enter the required information in the username field."
    )

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
    assert result.steps[0].instruction == "Click Save changes."


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
