from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from app.assistant_schema import (
    WalkthroughAssistantRequest,
    WalkthroughAssistantResponse,
)
from app.settings import SettingsError, get_openai_api_key, get_openai_model

router = APIRouter(prefix="/api/v1/assistant", tags=["assistant"])


def build_walkthrough_assistant_prompt(payload: WalkthroughAssistantRequest) -> str:
    step = payload.step

    return f"""
You are WorkTrace AI, a concise assistant helping an employee follow an SOP walkthrough.

Rules:
- Your main job is to help the user complete the current SOP walkthrough step.
- If the question is about the current step, answer it directly using the SOP step and page URL.
- If the question asks about a term, explain the term briefly, then connect it back to the current step.
- If the question is unrelated or conversational, briefly acknowledge it, then gently bring the user back to the current step.
- Do not invent hidden page content or claim to see things that are not provided.
- If the target highlight seems wrong, suggest switching to Manual Guide and following the written instruction.
- Keep the answer short, practical, and friendly.

Current context:
- Mode: {payload.mode}
- Page URL: {payload.page_url or "unknown"}
- Step: {step.index + 1} of {step.total}
- Step title: {step.title}
- Step instruction: {step.instruction}

User question:
{payload.question}
""".strip()


@router.post("/walkthrough", response_model=WalkthroughAssistantResponse)
async def walkthrough_assistant(
    payload: WalkthroughAssistantRequest,
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
        prompt = build_walkthrough_assistant_prompt(payload)

        completion = await client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": "You are WorkTrace AI, a helpful SOP walkthrough assistant.",
                },
                {
                    "role": "user",
                    "content": prompt,
                },
            ],
            temperature=0.2,
            max_tokens=180,
        )

        answer = completion.choices[0].message.content or ""

        return WalkthroughAssistantResponse(
            answer=answer.strip() or "I could not generate an answer for this step.",
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Assistant is unavailable right now.",
        ) from exc