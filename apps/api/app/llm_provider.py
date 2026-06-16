from typing import Protocol

from app.sop_schema import SopPayload


class SopLlmProvider(Protocol):
    name: str

    def generate_sop(self, session_payload: dict) -> SopPayload: ...
