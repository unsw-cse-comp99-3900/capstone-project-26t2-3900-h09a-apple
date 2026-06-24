from __future__ import annotations

import base64
import binascii
from datetime import datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


# 规定合法eventtype
class EventType(str, Enum):
    click = "click"
    navigation = "navigation"
    input = "input"
    submit = "submit"
    tab_switch = "tab_switch"


# 每个event必须有合法字段
class WTEventInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: EventType
    target_selector: str | None = None
    target_label: str | None = None
    value: str | None = Field(default=None, max_length=10000)
    url: str | None = None
    attrs: dict[str, object] = Field(default_factory=dict)
    screenshot_id: UUID | None = None
    timestamp_ms: int = Field(gt=0)


class ScreenshotInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID
    data_base64: str = Field(min_length=1)
    content_type: str = Field(default="image/png", pattern=r"^image/(png|jpeg|webp)$")
    width: int | None = Field(default=None, gt=0)
    height: int | None = Field(default=None, gt=0)

    @field_validator("data_base64")
    @classmethod
    def validate_base64(cls, value: str) -> str:
        try:
            base64.b64decode(value, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError("data_base64 must be valid base64") from exc
        return value


class SessionPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_session_id: UUID
    workflow_name: str = Field(min_length=1, max_length=200)
    recorded_by: UUID | None = None
    started_at: datetime
    stopped_at: datetime | None = None
    events: list[WTEventInput]
    screenshots: list[ScreenshotInput] = Field(default_factory=list)
