# SOP LLM Prompt Spike

## Goal

Validate whether an LLM can reliably generate structured SOP JSON from mock session payloads within the Sprint 1 pipeline budget.

The generated output must be valid JSON and pass validation against the `SopPayload` schema.

## Scope

This spike evaluates:

* JSON schema compliance
* Latency
* Estimated cost
* Model and prompt suitability

Out of scope:

* RAG
* Fine-tuning
* Production prompt engineering
* Real session data

## Test Inputs

Five mock session payloads were used:

1. `sample-login-flow`
2. `sample-create-project-flow`
3. `sample-search-filter-flow`
4. `sample-feedback-form-flow`
5. `sample-account-settings-flow`

Mock data location:

```text
apps/api/fixtures/mock_sessions.json
```

## Schema

The expected SOP output is defined in:

```text
apps/api/app/sop_schema.py
```

The output must validate against `SopPayload`.

Required fields:

* `title`
* `summary`
* `steps`
* `warnings`

Each step must include:

* `order`
* `title`
* `instruction`
* `source_event_ids`

## Evaluation Script

Evaluation script:

```text
apps/api/scripts/evaluate_sop_llm.py
```

The script records:

* API success
* Schema validation result
* Latency
* Token usage
* Estimated cost
* Error message if failed

## Prompt Candidate Results

Prompt candidates were tested using `gpt-5-mini` across 5 mock inputs.

| Prompt              | Schema Pass Rate | Avg Latency | P95 Latency |    Avg Cost |
| ------------------- | ---------------: | ----------: | ----------: | ----------: |
| `basic_json_only`   |              5/5 |     7.1407s |     7.0725s | $0.00113665 |
| `schema_strict`     |              5/5 |     7.5723s |     8.0899s | $0.00126005 |
| `schema_with_rules` |              5/5 |     7.8383s |     9.2265s | $0.00127310 |

Selected prompt: `basic_json_only`

Reason: all prompts passed schema validation, but `basic_json_only` had the lowest latency and lowest estimated cost.

## Model Comparison Results

The selected prompt, `basic_json_only`, was tested against two model candidates.

| Model        | Schema Pass Rate | Avg Latency | P95 Latency |    Avg Cost |  Total Cost |
| ------------ | ---------------: | ----------: | ----------: | ----------: | ----------: |
| `gpt-5-mini` |              5/5 |     7.7343s |     7.5939s | $0.00131265 | $0.00656325 |
| `gpt-5`      |              4/5 |    21.1329s |    24.1321s | $0.01132719 | $0.04530875 |

## Decision

Chosen model: `gpt-5-mini`

Chosen prompt: `basic_json_only`

Reason:

* `gpt-5-mini` passed schema validation on all 5 inputs.
* It was faster than `gpt-5`.
* It was significantly cheaper than `gpt-5`.
* Its P95 latency was under the 45-second acceptance threshold.
* `gpt-5` failed schema validation on 1 input.

## Final Prompt

### System Prompt

```text
You are an SOP generation assistant.
Return only valid JSON.
Do not include markdown or explanatory text.
```

### User Prompt Template

```text
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
```

## Strategy Interface

The provider interface is defined in:

```text
apps/api/app/llm_provider.py
```

Expected contract:

```python
class SopLlmProvider(Protocol):
    name: str

    def generate_sop(self, session_payload: dict) -> SopPayload:
        ...
```

## Notes

`gpt-4o-mini` was not used in the final comparison because the current API project returned model access errors during testing.

`gpt-5-mini` was selected as the recommended model for the Sprint 1 SOP JSON pipeline.
