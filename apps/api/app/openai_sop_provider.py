import json
import os

from app.llm_provider import LlmProviderResult, SopLlmProvider, estimate_cost_usd
from app.openai_client import create_openai_compatible_client
from app.sop_schema import SopPayload
from app.sop_semantic_schema import SessionSemanticAnalysis

SYSTEM_PROMPT = """
You are a senior operations analyst who turns noisy desktop recordings into concise,
goal-oriented standard operating procedures.

Return only valid JSON. Do not include markdown or explanatory text.
"""

ANALYSIS_SYSTEM_PROMPT = """
You are a desktop workflow investigator. Reconstruct the task the user actually performed
from an ordered semantic event timeline and visual keyframes.

Separate observed facts from inference. Never substitute generic UI activity for the user's
real goal. Return only valid JSON without markdown.
"""


def _text_session_payload(session_payload: dict) -> dict:
    frames = session_payload.get("vision_frames") or []
    return {
        **{
            key: value
            for key, value in session_payload.items()
            if key != "vision_frames"
        },
        "vision_frames": [
            {
                key: value
                for key, value in frame.items()
                if key != "data_url"
            }
            for frame in frames
        ],
    }


def build_semantic_analysis_prompt(session_payload: dict) -> str:
    schema = json.dumps(
        SessionSemanticAnalysis.model_json_schema(),
        default=str,
        separators=(",", ":"),
    )
    session_json = json.dumps(
        _text_session_payload(session_payload),
        default=str,
        separators=(",", ":"),
    )
    return f"""
Analyze this desktop recording before writing an SOP.

The output must validate against this JSON schema:
{schema}

Requirements:
- When workflow_name_is_placeholder is false, treat workflow_name as the user's declared
  recording intent. Use the event and visual evidence to recover how that intent was carried
  out, rather than replacing it with a guess based on the active application.
- Identify the concrete task, intended outcome, applications, files, commands, code, prompts,
  URLs, and other artifacts that are actually supported by the evidence.
- Read keyframes in chronological order and correlate each frame with its source_event_id.
- Use input_values as exact evidence. If a command, filename, code fragment, or prompt is
  visible in a keyframe, preserve its meaningful content rather than replacing it with
  phrases such as "initial commands", "desired filename", or "your code".
- Divide the recording into task stages based on changes in user intent and resulting state,
  not based merely on clicks or application switches.
- Each stage must cite only real source_event_ids from the supplied timeline.
- Ignore recorder controls, taskbar navigation, accidental clicks, corrections, and generic
  UI Automation labels.
- Do not conclude that the user created or ran a Python script merely because a window title
  contains ".py"; require supporting input, visual, or execution evidence.
- Put any important missing or ambiguous facts in uncertainties. Do not invent them.

Semantic timeline and keyframe metadata:
{session_json}
"""


def build_sop_prompt(
    session_payload: dict,
    semantic_analysis: SessionSemanticAnalysis,
) -> str:
    schema = json.dumps(SopPayload.model_json_schema(), default=str, separators=(",", ":"))
    session_json = json.dumps(
        _text_session_payload(session_payload),
        default=str,
        separators=(",", ":"),
    )
    analysis_json = semantic_analysis.model_dump_json()

    return f"""
Generate a structured SOP JSON payload from a verified task analysis and its supporting
semantic desktop action groups.

The output must validate against this JSON schema:
{schema}

Rules:
- Use the verified task analysis as the plan for the SOP. The semantic timeline is supporting
  evidence, not a list of steps to transcribe.
- If workflow_name_is_placeholder is true, replace it with a specific inferred SOP title.
- Produce outcome-oriented steps, not a transcription of UI events.
- A typical workflow should contain 4-10 steps. Use fewer for genuinely short workflows and
  more only when distinct business milestones require it.
- Every step must say what concrete result to produce. Include exact observed commands,
  filenames, code, prompts, and values when they are necessary to reproduce the task.
- Never replace observed content with vague placeholders such as "initial commands",
  "desired filename", "your code", "required information", or "make necessary adjustments".
- If necessary content is listed as uncertain or absent, do not invent it. Describe only the
  verified action and emit a missing_context warning identifying what could not be recovered.
- Combine related clicks, input, and submit actions into one meaningful step.
- Combine adjacent semantic action groups when they serve the same user intent.
- Ignore exploration, repeated clicks, corrections, recorder controls, taskbar/system-tray
  activity, and generic structural targets unless they are essential to the workflow.
- Never create one SOP step per semantic action group.
- Prefer exact, meaningful target names and non-masked input values when they clarify the task.
- Do not expose raw UI Automation terminology such as Pane, Group, Region, runtime ids, or
  automation ids in user-facing instructions.
- Do not claim that a click was a double-click unless the evidence says so.
- Every step must contain a non-empty source_event_ids list containing the union of real event
  ids from the semantic action groups that support that step.
- It is acceptable to omit irrelevant source events. Never invent source_event_ids.
- Keep instructions concise and executable. Describe what to accomplish and the necessary
  interaction, without narrating every low-level click.
- Emit warnings only for issues that materially affect successful completion.

Estimate time_estimate only from the step's source events:
- source event timestamps are in milliseconds since epoch.
- Compute active time from consecutive source events.
- Ignore idle gaps longer than 30 seconds.
- If a step has only one source event, use 5 seconds.
- If no reliable timestamp estimate can be inferred, use null.
- Clamp each step's time_estimate to a maximum of 60 seconds.
- Do not use total workflow duration as a step estimate.

Verified task analysis:
{analysis_json}

Supporting semantic session payload:
{session_json}
"""


def _analysis_message_content(session_payload: dict) -> list[dict] | str:
    text = build_semantic_analysis_prompt(session_payload)
    frames = session_payload.get("vision_frames") or []
    if not frames:
        return text

    content: list[dict] = [{"type": "text", "text": text}]
    for frame in frames:
        content.append(
            {
                "type": "text",
                "text": (
                    f"Keyframe {frame['frame_id']} at event "
                    f"{frame['source_event_id']} ({frame.get('application') or 'unknown app'}, "
                    f"{frame.get('window_title') or 'unknown window'})."
                ),
            }
        )
        content.append(
            {
                "type": "image_url",
                "image_url": {
                    "url": frame["data_url"],
                    "detail": "high",
                },
            }
        )
    return content


def _usage_value(response, field: str) -> int:
    usage = getattr(response, "usage", None)
    return int(getattr(usage, field, 0) or 0)


def _validate_source_event_ids(sop: SopPayload, session_payload: dict) -> None:
    valid_ids = {
        event_id
        for action in session_payload.get("semantic_actions", [])
        for event_id in action.get("source_event_ids", [])
    }
    valid_ids.update(
        frame["source_event_id"]
        for frame in session_payload.get("vision_frames", [])
        if frame.get("source_event_id")
    )
    for step in sop.steps:
        if not step.source_event_ids:
            raise RuntimeError(f"SOP step {step.order} has no source_event_ids")
        unknown_ids = set(step.source_event_ids) - valid_ids
        if unknown_ids:
            raise RuntimeError(
                f"SOP step {step.order} invented source_event_ids: {sorted(unknown_ids)}"
            )


class OpenAiSopProvider(SopLlmProvider):
    name = "openai"

    def __init__(self):
        self.model = os.getenv("OPENAI_MODEL", "gpt-4o")

    def generate_sop(self, session_payload: dict) -> LlmProviderResult:
        client = create_openai_compatible_client()

        analysis_response = client.chat.completions.create(
            model=self.model,
            response_format={"type": "json_object"},
            temperature=0.1,
            messages=[
                {"role": "system", "content": ANALYSIS_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": _analysis_message_content(session_payload),
                },
            ],
        )
        analysis_content = analysis_response.choices[0].message.content
        if not analysis_content:
            raise RuntimeError("OpenAI returned an empty semantic analysis")
        semantic_analysis = SessionSemanticAnalysis.model_validate_json(analysis_content)

        response = client.chat.completions.create(
            model=self.model,
            response_format={"type": "json_object"},
            temperature=0.2,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": build_sop_prompt(session_payload, semantic_analysis),
                },
            ],
        )

        content = response.choices[0].message.content

        if not content:
            raise RuntimeError("OpenAI returned an empty response")

        sop = SopPayload.model_validate_json(content)
        _validate_source_event_ids(sop, session_payload)
        prompt_tokens = _usage_value(analysis_response, "prompt_tokens") + _usage_value(
            response,
            "prompt_tokens",
        )
        completion_tokens = _usage_value(
            analysis_response,
            "completion_tokens",
        ) + _usage_value(response, "completion_tokens")

        return LlmProviderResult(
            sop=sop,
            prompt_tokens=prompt_tokens or None,
            completion_tokens=completion_tokens or None,
            cost_usd=estimate_cost_usd(
                self.name,
                self.model,
                prompt_tokens or None,
                completion_tokens or None,
            ),
        )
