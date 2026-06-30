from types import SimpleNamespace

from app.openai_sop_provider import OpenAiSopProvider


class FakeCompletions:
    def create(self, **kwargs):
        return SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(
                        content="""
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
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr("app.openai_sop_provider.OpenAI", FakeOpenAIClient)

    provider = OpenAiSopProvider()

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
    assert result.prompt_tokens == 10
    assert result.completion_tokens == 20
    assert payload.steps[0].branch is None
