from types import SimpleNamespace

from app.anthropic_sop_provider import AnthropicSopProvider


class FakeMessages:
    def create(self, **kwargs):
        return SimpleNamespace(
            content=[
                SimpleNamespace(
                    type="tool_use",
                    name="create_sop",
                    input={
                        "title": "Login Flow",
                        "summary": "User logs into the application.",
                        "steps": [
                            {
                                "order": 1,
                                "title": "Open login page",
                                "instruction": "Navigate to the login page.",
                                "branch": None,
                                "source_event_ids": ["1"],
                            }
                        ],
                        "warnings": [],
                    },
                )
            ],
            usage=SimpleNamespace(
                input_tokens=11,
                output_tokens=22,
            ),
        )


class FakeAnthropicClient:
    def __init__(self, api_key):
        self.messages = FakeMessages()


def test_anthropic_sop_provider_returns_valid_sop(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr("app.anthropic_sop_provider.Anthropic", FakeAnthropicClient)

    provider = AnthropicSopProvider()

    result = provider.generate_sop(
        {
            "workflow_name": "Login Flow",
            "events": [{"id": "1"}],
        }
    )
    payload = result.sop

    assert payload.title == "Login Flow"
    assert payload.steps[0].title == "Open login page"
    assert payload.steps[0].source_event_ids == ["1"]
    assert result.prompt_tokens == 11
    assert result.completion_tokens == 22
    assert payload.steps[0].branch is None