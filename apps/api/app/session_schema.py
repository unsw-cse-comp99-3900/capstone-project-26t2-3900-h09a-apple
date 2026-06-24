from __future__ import annotations

import base64
import binascii
from datetime import datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


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

MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024

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
            body = base64.b64decode(value, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError("data_base64 must be valid base64") from exc

        if len(body) > MAX_SCREENSHOT_BYTES:
            raise ValueError("screenshot must be 10MB or smaller")

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

    @model_validator(mode="after")
    def validate_screenshot_references(self) -> SessionPayload:
        screenshot_ids = [screenshot.id for screenshot in self.screenshots]

        if len(screenshot_ids) != len(set(screenshot_ids)):
            raise ValueError("screenshot ids must be unique")

        screenshot_id_set = set(screenshot_ids)
        missing_ids = [
            event.screenshot_id
            for event in self.events
            if event.screenshot_id is not None and event.screenshot_id not in screenshot_id_set
        ]

        if missing_ids:
            raise ValueError("event screenshot_id must reference an item in screenshots")

        return self