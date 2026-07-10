import time

from app import models
from app.llm_provider_factory import get_llm_provider
from app.mock_sop_generator import MockSopGenerator
from app.models import Session
from app.sop_generator import SopGenerator
from app.sop_schema import SopPayload


class LlmSopGenerator(SopGenerator):
    def __init__(self, db=None, max_retries: int = 3):
        self.db = db
        self.max_retries = max_retries
        self.generation_mode = "llm"

    def generate(self, session: Session) -> SopPayload:
        session_payload = self._build_session_payload(session)

        provider = get_llm_provider()

        for attempt in range(self.max_retries + 1):
            started = time.perf_counter()
            try:
                result = provider.generate_sop(session_payload)
                payload = result.sop

                latency_ms = int((time.perf_counter() - started) * 1000)
                self._log_audit(
                    session=session,
                    provider=provider,
                    status="success",
                    attempt=attempt + 1,
                    latency_ms=latency_ms,
                    prompt_tokens=result.prompt_tokens,
                    completion_tokens=result.completion_tokens,
                    cost_usd=result.cost_usd,
                )

                payload.generation_mode = "llm"
                self.generation_mode = "llm"
                return payload
            except Exception as exc:
                latency_ms = int((time.perf_counter() - started) * 1000)
                self._log_audit(
                    session=session,
                    provider=provider,
                    status="error",
                    attempt=attempt + 1,
                    latency_ms=latency_ms,
                    error_message=str(exc),
                )

                if attempt < self.max_retries:
                    time.sleep(2**attempt)

        fallback = MockSopGenerator()
        payload = fallback.generate(session)
        payload.generation_mode = "fallback"
        self.generation_mode = "fallback"
        return payload

    def _build_session_payload(self, session: Session) -> dict:
        events = sorted(session.events, key=lambda event: event.seq)

        return {
            "workflow_name": session.workflow_name,
            "events": [
                {
                    "id": str(event.id),
                    "seq": event.seq,
                    "type": event.type,
                    "target_label": event.target_label,
                    "target_selector": event.target_selector,
                    "value": getattr(event, "value", None),
                    "url": event.url,
                    "attrs": getattr(event, "attrs", {}) or {},
                    "page_title": (getattr(event, "attrs", {}) or {}).get("page_title"),
                    "timestamp_ms": getattr(event, "timestamp_ms", None),
                }
                for event in events
            ],
        }

    def _log_audit(
        self,
        session,
        provider,
        status: str,
        attempt: int,
        latency_ms: int,
        error_message: str | None = None,
        prompt_tokens: int | None = None,
        completion_tokens: int | None = None,
        cost_usd=None,
    ) -> None:
        if self.db is None:
            return

        self.db.add(
            models.LlmAuditLog(
                session_id=session.id,
                provider=provider.name,
                model=getattr(provider, "model", "unknown"),
                status=status,
                attempt=attempt,
                latency_ms=latency_ms,
                error_message=error_message,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                cost_usd=cost_usd,
            )
        )
