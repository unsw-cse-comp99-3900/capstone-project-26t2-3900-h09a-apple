"""
Request/response schemas for the walkthrough assistant API.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

AssistantTask = Literal[
    "qa",
    "coach",
    "recover",
    "match_step",
    "analyze",
    "handoff_summary",
]
ConfidenceLevel = Literal["high", "medium", "low"]


class WalkthroughAssistantStep(BaseModel):
    index: int = Field(ge=0)
    total: int = Field(ge=1)
    title: str = Field(min_length=1)
    instruction: str = Field(default="")


class WalkthroughAssistantRequest(BaseModel):
    task: AssistantTask = "qa"
    question: str | None = Field(default=None, max_length=1000)
    mode: str = Field(default="walkthrough", max_length=50)
    page_url: str | None = Field(default=None, max_length=2000)
    page_title: str | None = Field(default=None, max_length=500)
    screenshot_b64: str | None = Field(default=None, max_length=6_000_000)
    expected_target: str | None = Field(default=None, max_length=1000)
    actual_action: str | None = Field(default=None, max_length=1000)
    steps_summary: str | None = Field(default=None, max_length=8000)
    step: WalkthroughAssistantStep

    @model_validator(mode="after")
    def validate_task_inputs(self) -> WalkthroughAssistantRequest:
        if self.task == "qa":
            question = (self.question or "").strip()
            if not question:
                raise ValueError("question is required for task=qa")
            self.question = question
        return self


class WalkthroughAssistantResponse(BaseModel):
    answer: str
    confidence: ConfidenceLevel = "medium"
    confidence_reason: str = ""
