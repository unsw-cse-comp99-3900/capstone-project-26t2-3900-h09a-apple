from types import SimpleNamespace

from app.openai_sop_provider import OpenAiSopProvider


class FakeCompletions:
    def __init__(self):
        self.kwargs = None
        self.calls = []

    def create(self, **kwargs):
        self.kwargs = kwargs
        self.calls.append(kwargs)
        if len(self.calls) == 1:
            content = """
            {
              "inferred_goal": "Log into the application",
              "desired_outcome": "Reach the authenticated workspace",
              "applications": ["Browser"],
              "artifacts": [],
              "stages": [
                {
                  "name": "Authenticate",
                  "objective": "Open the login page and sign in",
                  "evidence": ["Login controls are present"],
                  "source_event_ids": ["1"]
                }
              ],
              "uncertainties": []
            }
            """
        else:
            content = """
            {
              "title": "Login Flow",
              "summary": "User logs into the application.",
              "steps": [
                {
                  "order": 1,
                  "title": "Open login page",
                  "instruction": "Navigate to the login page.",
                  "branch": null,
                  "source_event_ids": ["1"]
                }
              ],
              "warnings": []
            }
            """
        return SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(
                        content=content
                    )
                )
            ],
            usage=SimpleNamespace(
                prompt_tokens=10,
                completion_tokens=20,
            ),
        )


class FakeChat:
    def __init__(self):
        self.completions = FakeCompletions()


class FakeOpenAIClient:
    def __init__(self, api_key):
        self.chat = FakeChat()


def test_openai_sop_provider_returns_valid_sop(monkeypatch):
    client = FakeOpenAIClient("test-key")
    monkeypatch.setattr(
        "app.openai_sop_provider.create_openai_compatible_client",
        lambda: client,
    )

    provider = OpenAiSopProvider()

    result = provider.generate_sop(
        {
            "workflow_name": "Login Flow",
            "workflow_name_is_placeholder": False,
            "raw_event_count": 3,
            "semantic_action_count": 1,
            "semantic_actions": [
                {
                    "group_id": "g001",
                    "action_type": "input_and_submit",
                    "source_event_ids": ["1", "2", "3"],
                }
            ],
        }
    )

    payload = result.sop

    assert payload.title == "Login Flow"
    assert payload.steps[0].title == "Open login page"
    assert payload.steps[0].source_event_ids == ["1"]
    assert result.prompt_tokens == 20
    assert result.completion_tokens == 40
    assert payload.steps[0].branch is None
    assert client.chat.completions.kwargs["temperature"] == 0.2
    prompt = client.chat.completions.kwargs["messages"][1]["content"]
    assert "Never create one SOP step per semantic action group" in prompt
    assert '"semantic_actions"' in prompt
    assert '"events"' not in prompt
    assert len(client.chat.completions.calls) == 2
