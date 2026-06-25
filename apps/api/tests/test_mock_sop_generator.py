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
                url="https://example.com/login",
                target_label=None,
                target_selector=None,
            ),
            SimpleNamespace(
                id=2,
                seq=1,
                type="input",
                url=None,
                target_label="username",
                target_selector=None,
            ),
        ],
    )

    generator = MockSopGenerator()
    result = generator.generate(session)

    assert result.title == "Login Flow"
    assert len(result.steps) == 1
    assert result.steps[0].title != ""
    assert result.steps[0].instruction != ""

    assert isinstance(result, SopPayload)


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
            ),
            SimpleNamespace(
                id=2,
                seq=1,
                type="click",
                url=None,
                target_label="save",
                target_selector=None,
            ),
            SimpleNamespace(
                id=3,
                seq=2,
                type="navigation",
                url="page2",
                target_label=None,
                target_selector=None,
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
            ),
            SimpleNamespace(
                id=2,
                seq=1,
                type="click",
                url=None,
                target_label="save",
                target_selector=None,
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
            ),
        ],
    )

    generator = MockSopGenerator()
    result = generator.generate(session)

    assert len(result.steps) == 1
    assert result.steps[0].title == "Step 1"
