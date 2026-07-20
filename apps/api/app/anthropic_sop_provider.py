import json
import os

from anthropic import Anthropic

from app.llm_provider import LlmProviderResult, SopLlmProvider, estimate_cost_usd
from app.navigation_source_ids import NAVIGATION_SOURCE_EVENT_ID_RULE
from app.sop_schema import SopPayload

SYSTEM_PROMPT = """
You are an SOP generation assistant.
Return a structured SOP by calling the create_sop tool.
Do not include explanatory text.
"""


def build_sop_prompt(session_payload: dict) -> str:
    return f"""
Generate a structured SOP from the following session payload.

Use only the create_sop tool schema.
Every step must reference the source event ids that support it.
Do not invent source_event_ids.
{NAVIGATION_SOURCE_EVENT_ID_RULE}

For each step, include time_estimate as an integer number of seconds.

Estimate time_estimate only from the step's source events:
- source event timestamps are in milliseconds since epoch.
- Compute active time from consecutive source events.
- Ignore idle gaps longer than 30 seconds.
- If a step has only one source event, use 5 seconds.
- If no reliable timestamp estimate can be inferred, use null.
- Clamp each step's time_estimate to a maximum of 60 seconds.
- Do not use total workflow duration as a step estimate.

Session payload:
{json.dumps(session_payload, default=str)}
"""


class AnthropicSopProvider(SopLlmProvider):
    name = "anthropic"

    def __init__(self):
        self.model = os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-20241022")
        self.api_key = os.getenv("ANTHROPIC_API_KEY")

    def generate_sop(self, session_payload: dict) -> LlmProviderResult:
        if not self.api_key:
            raise RuntimeError("ANTHROPIC_API_KEY is not configured")

        client = Anthropic(api_key=self.api_key)

        response = client.messages.create(
            model=self.model,
            max_tokens=2000,
            system=SYSTEM_PROMPT,
            tools=[
                {
                    "name": "create_sop",
                    "description": "Create a structured SOP payload from a recorded workflow.",
                    "input_schema": SopPayload.model_json_schema(),
                }
            ],
            tool_choice={"type": "tool", "name": "create_sop"},
            messages=[
                {
                    "role": "user",
                    "content": build_sop_prompt(session_payload),
                }
            ],
        )

        for block in response.content:
            if (
                getattr(block, "type", None) == "tool_use"
                and getattr(block, "name", None) == "create_sop"
            ):
                sop = SopPayload.model_validate(block.input)
                usage = response.usage

                return LlmProviderResult(
                    sop=sop,
                    prompt_tokens=usage.input_tokens if usage else None,
                    completion_tokens=usage.output_tokens if usage else None,
                    cost_usd=estimate_cost_usd(
                        self.name,
                        self.model,
                        usage.input_tokens if usage else None,
                        usage.output_tokens if usage else None,
                    ),
                )

        raise RuntimeError("Anthropic did not return create_sop tool output")
