from __future__ import annotations

from pydantic import BaseModel, Field


class WalkthroughAssistantStep(BaseModel):
    index: int = Field(ge=0)
    total: int = Field(ge=1)
    title: str = Field(min_length=1)
    instruction: str = Field(default="")


class WalkthroughAssistantRequest(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    mode: str = Field(default="walkthrough", max_length=50)
    page_url: str | None = Field(default=None, max_length=2000)
    step: WalkthroughAssistantStep


class WalkthroughAssistantResponse(BaseModel):
    answer: str
