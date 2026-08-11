from __future__ import annotations

from types import SimpleNamespace

from app.feedback_classification import (
    _parse_classification_payload,
    classify_feedback_transcript,
)
from app.feedback_storage import ClassificationResult
from app.models import FeedbackClassification, FeedbackPolarity, FeedbackSeverity


def test_parse_classification_payload_valid_json():
    result = _parse_classification_payload(
        '{"classification":"friction","polarity":"issue","severity":"high"}'
    )

    assert result == ClassificationResult(
        classification=FeedbackClassification.friction,
        polarity=FeedbackPolarity.issue,
        severity=FeedbackSeverity.high,
    )


def test_parse_classification_payload_extracts_json_object_from_noise():
    result = _parse_classification_payload(
        'Sure!\n{"classification":"question","polarity":"issue","severity":"medium"}\nThanks'
    )

    assert result == ClassificationResult(
        classification=FeedbackClassification.question,
        polarity=FeedbackPolarity.issue,
        severity=FeedbackSeverity.medium,
    )


def test_parse_classification_payload_returns_none_for_non_json():
    assert _parse_classification_payload("not json at all") is None


def test_parse_classification_payload_returns_none_for_invalid_embedded_json():
    assert _parse_classification_payload("prefix {not-valid-json} suffix") is None


def test_parse_classification_payload_returns_none_for_missing_or_invalid_fields():
    assert _parse_classification_payload('{"classification":"friction","polarity":"issue"}') is None
    assert (
        _parse_classification_payload(
            '{"classification":"unknown","polarity":"issue","severity":"high"}'
        )
        is None
    )


def test_classify_feedback_transcript_empty_returns_default():
    result = classify_feedback_transcript("   ")

    assert result == ClassificationResult(
        classification=FeedbackClassification.suggestion,
        polarity=FeedbackPolarity.issue,
        severity=FeedbackSeverity.low,
    )


def test_classify_feedback_transcript_uses_heuristic_without_api_key(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    result = classify_feedback_transcript("The form is broken and I am stuck")

    assert result == ClassificationResult(
        classification=FeedbackClassification.friction,
        polarity=FeedbackPolarity.issue,
        severity=FeedbackSeverity.high,
    )


def test_classify_feedback_transcript_llm_success(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setenv("OPENAI_MODEL", "gpt-test")

    class FakeCompletions:
        def create(self, **kwargs):
            assert kwargs["model"] == "gpt-test"
            assert kwargs["response_format"] == {"type": "json_object"}
            return SimpleNamespace(
                choices=[
                    SimpleNamespace(
                        message=SimpleNamespace(
                            content=(
                                '{"classification":"suggestion","polarity":"positive",'
                                '"severity":"low"}'
                            )
                        )
                    )
                ]
            )

    class FakeClient:
        def __init__(self):
            self.chat = SimpleNamespace(completions=FakeCompletions())

    monkeypatch.setattr(
        "app.feedback_classification.create_openai_compatible_client",
        lambda: FakeClient(),
    )

    result = classify_feedback_transcript("This works well, thanks!")

    assert result == ClassificationResult(
        classification=FeedbackClassification.suggestion,
        polarity=FeedbackPolarity.positive,
        severity=FeedbackSeverity.low,
    )


def test_classify_feedback_transcript_llm_bad_json_falls_back_to_heuristic(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")

    class FakeCompletions:
        def create(self, **_kwargs):
            return SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content="not-json"))]
            )

    class FakeClient:
        def __init__(self):
            self.chat = SimpleNamespace(completions=FakeCompletions())

    monkeypatch.setattr(
        "app.feedback_classification.create_openai_compatible_client",
        lambda: FakeClient(),
    )

    result = classify_feedback_transcript("How do I submit this form?")

    assert result == ClassificationResult(
        classification=FeedbackClassification.question,
        polarity=FeedbackPolarity.issue,
        severity=FeedbackSeverity.medium,
    )


def test_classify_feedback_transcript_llm_exception_falls_back_to_heuristic(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")

    def _boom():
        raise RuntimeError("llm down")

    monkeypatch.setattr(
        "app.feedback_classification.create_openai_compatible_client",
        _boom,
    )

    result = classify_feedback_transcript("I suggest we improve the wording")

    assert result == ClassificationResult(
        classification=FeedbackClassification.suggestion,
        polarity=FeedbackPolarity.issue,
        severity=FeedbackSeverity.low,
    )
