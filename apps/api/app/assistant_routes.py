from __future__ import annotations

import re
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status

from app.assistant_schema import (
    AssistantTask,
    ConfidenceLevel,
    WalkthroughAssistantRequest,
    WalkthroughAssistantResponse,
)
from app.auth.deps import require_role
from app.models import User, UserRole
from app.settings import SettingsError, get_openai_api_key, get_openai_model

# H09AAPPLE-80 remaining (extension ball is source of truth; do not extend web floating-assistant):
# T0-1/T0-2: done on this endpoint (task dispatch + confidence + auth)
# T1-4 role is already injected into shared context via current_user
# T2-2 vision path for task=analyze (optional OPENAI_VISION_MODEL)
# T3-3 handoff_summary notify reviewer/manager after response

router = APIRouter(prefix="/api/v1/assistant", tags=["assistant"])

_CONFIDENCE_RE = re.compile(r"(?im)^\s*CONFIDENCE:\s*(high|medium|low)\s*[-:]+\s*(.+?)\s*$")

_CONFIDENCE_RULES = """
End your reply with a final line exactly in this form:
CONFIDENCE: high|medium|low - <one short reason>
Use low when the provided context does not let you verify the step.
Never guess when uncertain.
""".strip()

_TASK_PROMPTS: dict[AssistantTask, str] = {
    "qa": """
You are WorkTrace AI, a concise assistant helping an employee follow an SOP walkthrough.

Rules:
- Your main job is to help the user complete the current SOP walkthrough step.
- If the question is about the current step, answer it directly using the SOP step and page URL.
- If the question asks about a term, explain the term briefly, then connect it back to the current step.
- If the question is unrelated or conversational, briefly acknowledge it, then gently bring the user back to the current step.
- Do not invent hidden page content or claim to see things that are not provided.
- If the target highlight seems wrong, suggest switching to Manual Guide and following the written instruction.
- Keep the answer short, practical, and friendly.
""".strip(),
    "coach": """
Rewrite the current SOP step instruction so it is clearer and more specific for an employee.
Rules:
- Preserve the original intent.
- Do not invent actions or UI that are not supported by the provided context.
- Output only the rewritten instruction text (no preface).
""".strip(),
    "recover": """
The employee appears off the expected walkthrough path.
Give a concrete recovery path back to the current step using 2-4 imperative sentences.
Rules:
- Be specific and actionable.
- If you are unsure, say you are unsure.
- Do not invent page elements that are not supported by the provided context.
""".strip(),
    "match_step": """
Infer which SOP step best matches the employee's current page.
Rules:
- Prefer steps whose expected URL or title matches the current page.
- Reply with: MATCH: <1-based step number or null> - <one short reason>
- If there is no clear match, use null.
""".strip(),
    "analyze": """
The employee clicked "I am stuck". Compare the current page context (and screenshot if provided)
against the current SOP step.
Rules:
- Say where the user appears to be, how that differs from the expected step, and what to click next.
- If the screenshot or context is unclear, say so.
- Do not invent UI that you cannot see in the provided context.
""".strip(),
    "handoff_summary": """
Write a short handoff summary for a human reviewer or manager in exactly three sentences:
1) which step the user is stuck on,
2) what the SOP expected,
3) what the current page appears to be.
Keep it factual and concise.
""".strip(),
}


def _shared_context(payload: WalkthroughAssistantRequest, role: str) -> str:
    step = payload.step
    lines = [
        f"- Mode: {payload.mode}",
        f"- User role: {role}",
        f"- Page URL: {payload.page_url or 'unknown'}",
        f"- Page title: {payload.page_title or 'unknown'}",
        f"- Step: {step.index + 1} of {step.total}",
        f"- Step title: {step.title}",
        f"- Step instruction: {step.instruction}",
    ]
    if payload.expected_target:
        lines.append(f"- Expected target: {payload.expected_target}")
    if payload.actual_action:
        lines.append(f"- Actual action: {payload.actual_action}")
    if payload.steps_summary:
        lines.append(f"- Steps summary:\n{payload.steps_summary}")
    if role.upper() == "EMPLOYEE":
        lines.append(
            "- If this step requires approve / publish / manage permissions, "
            "tell the employee to ask a manager or reviewer."
        )
    return "\n".join(lines)


def build_walkthrough_assistant_prompt(
    payload: WalkthroughAssistantRequest,
    *,
    role: str = "EMPLOYEE",
) -> str:
    task_prompt = _TASK_PROMPTS[payload.task]
    parts = [
        task_prompt,
        "",
        "Current context:",
        _shared_context(payload, role),
    ]
    if payload.task == "qa" and payload.question:
        parts.extend(["", "User question:", payload.question])
    elif payload.question:
        parts.extend(["", "Additional user note:", payload.question])
    parts.extend(["", _CONFIDENCE_RULES])
    return "\n".join(parts).strip()


def parse_confidence_footer(raw: str) -> tuple[str, ConfidenceLevel, str]:
    text = (raw or "").strip()
    if not text:
        return (
            "I could not generate an answer for this step.",
            "low",
            "Empty model response",
        )

    matches = list(_CONFIDENCE_RE.finditer(text))
    if not matches:
        return text, "medium", "Model did not report confidence"

    match = matches[-1]
    level = match.group(1).lower()
    reason = match.group(2).strip()
    if level not in {"high", "medium", "low"}:
        level = "medium"
    answer = (text[: match.start()] + text[match.end() :]).strip()
    if not answer:
        answer = "I could not generate an answer for this step."
    confidence: ConfidenceLevel = "medium"
    if level in {"high", "medium", "low"}:
        confidence = level  # type: ignore[assignment]
    return answer, confidence, reason or "No reason provided"


def _data_url_for_screenshot(screenshot_b64: str) -> str:
    value = screenshot_b64.strip()
    if value.startswith("data:"):
        return value
    return f"data:image/jpeg;base64,{value}"


def _user_message_content(payload: WalkthroughAssistantRequest, prompt: str) -> Any:
    if payload.task == "analyze" and payload.screenshot_b64:
        return [
            {"type": "text", "text": prompt},
            {
                "type": "image_url",
                "image_url": {"url": _data_url_for_screenshot(payload.screenshot_b64)},
            },
        ]
    return prompt


@router.post("/walkthrough", response_model=WalkthroughAssistantResponse)
async def walkthrough_assistant(
    payload: WalkthroughAssistantRequest,
    current_user: Annotated[User, Depends(require_role(UserRole.employee))],
) -> WalkthroughAssistantResponse:
    try:
        api_key = get_openai_api_key()
        model = get_openai_model()
    except SettingsError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    try:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=api_key)
        role = str(current_user.role)
        prompt = build_walkthrough_assistant_prompt(payload, role=role)
        max_tokens = 180 if payload.task == "qa" else 320

        completion = await client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": "You are WorkTrace AI, a helpful SOP walkthrough assistant.",
                },
                {
                    "role": "user",
                    "content": _user_message_content(payload, prompt),
                },
            ],
            temperature=0.2,
            max_tokens=max_tokens,
        )

        raw = completion.choices[0].message.content or ""
        answer, confidence, confidence_reason = parse_confidence_footer(raw)

        return WalkthroughAssistantResponse(
            answer=answer,
            confidence=confidence,
            confidence_reason=confidence_reason,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Assistant is unavailable right now.",
        ) from exc
