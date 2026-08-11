"""
Classify voice-feedback transcripts (heuristic or LLM fallback).
"""

from __future__ import annotations

import json
import logging
import os
import re

from app.feedback_storage import ClassificationResult, classify_feedback_heuristic
from app.models import FeedbackClassification, FeedbackPolarity, FeedbackSeverity
from app.openai_client import create_openai_compatible_client

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """
You classify short employee voice-feedback transcripts about workplace SOPs.
Return only valid JSON with keys:
  classification: one of friction, question, suggestion
  polarity: one of issue, positive
  severity: one of high, medium, low
No markdown.
""".strip()


def _parse_classification_payload(raw: str) -> ClassificationResult | None:
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", raw, flags=re.DOTALL)
        if not match:
            return None
        try:
            payload = json.loads(match.group(0))
        except json.JSONDecodeError:
            return None

    try:
        return ClassificationResult(
            classification=FeedbackClassification(str(payload["classification"])),
            polarity=FeedbackPolarity(str(payload["polarity"])),
            severity=FeedbackSeverity(str(payload["severity"])),
        )
    except (KeyError, ValueError, TypeError):
        return None


def classify_feedback_transcript(transcript: str) -> ClassificationResult:
    cleaned = transcript.strip()
    if not cleaned:
        return ClassificationResult(
            classification=FeedbackClassification.suggestion,
            polarity=FeedbackPolarity.issue,
            severity=FeedbackSeverity.low,
        )

    if not (os.getenv("OPENAI_API_KEY") or os.getenv("OPENROUTER_API_KEY")):
        return classify_feedback_heuristic(cleaned)

    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    try:
        client = create_openai_compatible_client()
        response = client.chat.completions.create(
            model=model,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": f"Classify this feedback transcript:\n{cleaned}",
                },
            ],
            temperature=0,
        )
        content = response.choices[0].message.content or ""
        parsed = _parse_classification_payload(content)
        if parsed is not None:
            return parsed
    except Exception:
        logger.exception("LLM feedback classification failed; using heuristic")

    return classify_feedback_heuristic(cleaned)
