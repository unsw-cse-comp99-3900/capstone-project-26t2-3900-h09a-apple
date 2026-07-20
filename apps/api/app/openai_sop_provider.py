import json
import os

from app.llm_provider import LlmProviderResult, SopLlmProvider, estimate_cost_usd
from app.navigation_source_ids import NAVIGATION_SOURCE_EVENT_ID_RULE
from app.openai_client import create_openai_compatible_client
from app.sop_schema import SopPayload

SYSTEM_PROMPT = """
You are an SOP generation assistant.
Return only valid JSON.
Do not include markdown or explanatory text.
"""


def build_sop_prompt(session_payload: dict) -> str:
    return f"""
Generate a structured SOP JSON payload from the following session payload.

The output must validate against this JSON schema:
{json.dumps(SopPayload.model_json_schema(), default=str)}

Use only the fields defined in the schema.
Every step must reference the source event ids that support it.
Do not invent source_event_ids.
{NAVIGATION_SOURCE_EVENT_ID_RULE}

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


class OpenAiSopProvider(SopLlmProvider):
    name = "openai"

    def __init__(self):
        self.model = os.getenv("OPENAI_MODEL", "gpt-4o")

    def generate_sop(self, session_payload: dict) -> LlmProviderResult:
        client = create_openai_compatible_client()

        response = client.chat.completions.create(
            model=self.model,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": build_sop_prompt(session_payload)},
            ],
        )

        content = response.choices[0].message.content

        if not content:
            raise RuntimeError("OpenAI returned an empty response")

        sop = SopPayload.model_validate_json(content)
        usage = response.usage

        return LlmProviderResult(
            sop=sop,
            prompt_tokens=usage.prompt_tokens if usage else None,
            completion_tokens=usage.completion_tokens if usage else None,
            cost_usd=estimate_cost_usd(
                self.name,
                self.model,
                usage.prompt_tokens if usage else None,
                usage.completion_tokens if usage else None,
            ),
        )
