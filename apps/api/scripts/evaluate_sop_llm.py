import json
import os
import time
from pathlib import Path

from openai import OpenAI
from pydantic import ValidationError

from app.sop_schema import SopPayload

API_ROOT = Path(__file__).resolve().parents[1]
FIXTURES_PATH = API_ROOT / "fixtures" / "mock_sessions.json"


MODEL_PRICING_USD_PER_1M = {
    "gpt-5-mini": {
        "input": 0.25,
        "output": 2.00,
    },
    "gpt-5": {
        "input": 1.25,
        "output": 10.00,
    },
}


PROMPT_CANDIDATES = {
    "basic_json_only": {
        "system": """
You are an SOP generation assistant.
Return only valid JSON.
Do not include markdown or explanatory text.
""".strip(),
        "user_template": """
Generate a structured SOP JSON payload from the following session payload.

Required JSON structure:
{
  "title": "string",
  "summary": "string",
  "steps": [
    {
      "order": 1,
      "title": "string",
      "instruction": "string",
      "source_event_ids": ["string"]
    }
  ],
  "warnings": []
}

Session payload:
{{SESSION_PAYLOAD_JSON}}
""".strip(),
    },
    "schema_strict": {
        "system": """
You are an SOP generation assistant.
Return only valid JSON matching the SopPayload schema.
Do not include markdown, comments, or explanatory text.
Every required field must be present.
""".strip(),
        "user_template": """
Generate a structured SOP JSON payload from the following session payload.

The output must match this schema exactly:
{
  "title": "string",
  "summary": "string",
  "steps": [
    {
      "order": 1,
      "title": "string",
      "instruction": "string",
      "source_event_ids": ["string"]
    }
  ],
  "warnings": []
}

Validation requirements:
- title must be non-empty.
- summary must be non-empty.
- steps must contain at least one item.
- each step must have order, title, instruction, and source_event_ids.
- warnings must be an array.

Session payload:
{{SESSION_PAYLOAD_JSON}}
""".strip(),
    },
    "schema_with_rules": {
        "system": """
You are an SOP generation assistant.
Return only valid JSON matching the SopPayload schema.
Do not include markdown, comments, or explanatory text.
Generate clear SOP steps from the provided session events.
""".strip(),
        "user_template": """
Generate a structured SOP JSON payload from the following session payload.

The output must match this schema:
{
  "title": "string",
  "summary": "string",
  "steps": [
    {
      "order": 1,
      "title": "string",
      "instruction": "string",
      "source_event_ids": ["string"]
    }
  ],
  "warnings": []
}

Rules:
- Return JSON only.
- Do not include markdown.
- Each step must have a non-empty title and instruction.
- Use only source_event_ids that exist in the input session events.
- Keep the SOP concise and action-oriented.

Session payload:
{{SESSION_PAYLOAD_JSON}}
""".strip(),
    },
}


def build_user_prompt(prompt_name: str, session_payload: dict) -> str:
    prompt_config = PROMPT_CANDIDATES[prompt_name]
    return prompt_config["user_template"].replace(
        "{{SESSION_PAYLOAD_JSON}}",
        json.dumps(session_payload, indent=2),
    )


def get_system_prompt(prompt_name: str) -> str:
    return PROMPT_CANDIDATES[prompt_name]["system"]


def estimate_cost_usd(
    model: str,
    prompt_tokens: int,
    completion_tokens: int,
) -> float:
    pricing = MODEL_PRICING_USD_PER_1M.get(model)

    if pricing is None:
        return 0.0

    input_cost = prompt_tokens / 1_000_000 * pricing["input"]
    output_cost = completion_tokens / 1_000_000 * pricing["output"]

    return input_cost + output_cost


def call_openai(
    client: OpenAI,
    model: str,
    prompt_name: str,
    session_payload: dict,
) -> tuple[str, int, int, int]:
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": get_system_prompt(prompt_name)},
            {"role": "user", "content": build_user_prompt(prompt_name, session_payload)},
        ],
        response_format={"type": "json_object"},
    )

    content = response.choices[0].message.content

    if content is None:
        raise ValueError("OpenAI returned empty content")

    usage = response.usage

    if usage is None:
        raise ValueError("OpenAI returned no usage data")

    return (
        content,
        usage.prompt_tokens,
        usage.completion_tokens,
        usage.total_tokens,
    )


def percentile_95(values: list[float]) -> float:
    if not values:
        return 0.0

    sorted_values = sorted(values)
    index = int(0.95 * (len(sorted_values) - 1))
    return sorted_values[index]


def main() -> None:
    if not os.getenv("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY is not set. Please export it first.")

    client = OpenAI()

    with open(FIXTURES_PATH, encoding="utf-8") as file:
        sessions = json.load(file)

    models = ["gpt-5-mini", "gpt-5"]
    prompt_names = ["basic_json_only"]

    all_results = []

    for model in models:
        for prompt_name in prompt_names:
            model_prompt_results = []

            for session in sessions:
                start_time = time.perf_counter()

                try:
                    raw_output, prompt_tokens, completion_tokens, total_tokens = call_openai(
                        client,
                        model,
                        prompt_name,
                        session,
                    )

                    parsed_json = json.loads(raw_output)
                    validated_sop = SopPayload.model_validate(parsed_json)

                    latency_seconds = time.perf_counter() - start_time
                    estimated_cost_usd = estimate_cost_usd(
                        model,
                        prompt_tokens,
                        completion_tokens,
                    )

                    result = {
                        "model": model,
                        "prompt_name": prompt_name,
                        "session_id": session["id"],
                        "api_success": True,
                        "schema_valid": True,
                        "latency_seconds": round(latency_seconds, 4),
                        "step_count": len(validated_sop.steps),
                        "warning_count": len(validated_sop.warnings),
                        "prompt_tokens": prompt_tokens,
                        "completion_tokens": completion_tokens,
                        "total_tokens": total_tokens,
                        "estimated_cost_usd": round(estimated_cost_usd, 8),
                        "error": None,
                    }

                except (json.JSONDecodeError, ValidationError, Exception) as error:
                    latency_seconds = time.perf_counter() - start_time

                    result = {
                        "model": model,
                        "prompt_name": prompt_name,
                        "session_id": session["id"],
                        "api_success": False,
                        "schema_valid": False,
                        "latency_seconds": round(latency_seconds, 4),
                        "step_count": 0,
                        "warning_count": 0,
                        "prompt_tokens": 0,
                        "completion_tokens": 0,
                        "total_tokens": 0,
                        "estimated_cost_usd": 0.0,
                        "error": str(error),
                    }

                model_prompt_results.append(result)
                all_results.append(result)

            successful_api_results = [item for item in model_prompt_results if item["api_success"]]
            schema_pass_count = sum(1 for item in model_prompt_results if item["schema_valid"])

            if successful_api_results:
                latencies = [item["latency_seconds"] for item in successful_api_results]
                costs = [item["estimated_cost_usd"] for item in successful_api_results]

                avg_latency_seconds = round(sum(latencies) / len(latencies), 4)
                p95_latency_seconds = round(percentile_95(latencies), 4)
                avg_estimated_cost_usd = round(sum(costs) / len(costs), 8)
                total_estimated_cost_usd = round(sum(costs), 8)
            else:
                avg_latency_seconds = None
                p95_latency_seconds = None
                avg_estimated_cost_usd = None
                total_estimated_cost_usd = None

            summary = {
                "model": model,
                "prompt_name": prompt_name,
                "inputs_tested": len(model_prompt_results),
                "successful_api_calls": len(successful_api_results),
                "schema_pass_rate": f"{schema_pass_count}/{len(model_prompt_results)}",
                "avg_latency_seconds": avg_latency_seconds,
                "p95_latency_seconds": p95_latency_seconds,
                "avg_estimated_cost_usd": avg_estimated_cost_usd,
                "total_estimated_cost_usd": total_estimated_cost_usd,
            }

            print("\nMODEL SUMMARY")
            print(json.dumps(summary, indent=2))

    print("\nDETAILED RESULTS")
    print(json.dumps(all_results, indent=2))


if __name__ == "__main__":
    main()
