import base64
import time

from app import models
from app.llm_provider_factory import get_llm_provider
from app.mock_sop_generator import MockSopGenerator
from app.models import Session
from app.sop_event_normalizer import normalize_session_events
from app.sop_generator import SopGenerator
from app.sop_schema import SopPayload
from app.storage import get_storage

MAX_VISION_FRAMES = 8
MAX_COMMIT_VISION_FRAMES = 5


def _evenly_sample(items: list[object], count: int) -> list[object]:
    if count <= 0:
        return []
    if len(items) <= count:
        return items

    last_index = len(items) - 1
    indexes = {
        round(index * last_index / (count - 1))
        for index in range(count)
    } if count > 1 else {last_index}
    return [item for index, item in enumerate(items) if index in indexes]


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
        payload = fallback.generate_from_semantic_actions(
            workflow_name=session.workflow_name,
            actions=session_payload["semantic_actions"],
        )
        payload.generation_mode = "fallback"
        self.generation_mode = "fallback"
        return payload

    def _build_session_payload(self, session: Session) -> dict:
        events = sorted(session.events, key=lambda event: event.seq)
        semantic_actions = normalize_session_events(events)
        vision_frames = self._build_vision_frames(session, events)
        workflow_name = session.workflow_name
        placeholder_names = {
            "untitled desktop recording",
            "untitled recording",
            "untitled workflow",
        }

        return {
            "workflow_name": workflow_name,
            "workflow_name_is_placeholder": workflow_name.strip().casefold() in placeholder_names,
            "raw_event_count": len(events),
            "semantic_action_count": len(semantic_actions),
            "semantic_actions": semantic_actions,
            "vision_frames": vision_frames,
        }

    def _build_vision_frames(self, session: Session, events: list[object]) -> list[dict]:
        screenshot_events = [
            event for event in events if getattr(event, "screenshot_id", None) is not None
        ]
        screenshots = {
            str(screenshot.id): screenshot
            for screenshot in (getattr(session, "screenshots", None) or [])
        }
        if not screenshot_events or not screenshots:
            return []

        commit_events = [
            event
            for event in screenshot_events
            if str(getattr(event, "type", "")) in {"input", "submit"}
        ]
        selected_events = _evenly_sample(
            commit_events,
            min(MAX_COMMIT_VISION_FRAMES, len(commit_events)),
        )
        selected_ids = {str(getattr(event, "id")) for event in selected_events}
        context_candidates = [
            event
            for event in screenshot_events
            if str(getattr(event, "id")) not in selected_ids
        ]
        selected_events.extend(
            _evenly_sample(
                context_candidates,
                MAX_VISION_FRAMES - len(selected_events),
            )
        )
        selected_events.sort(key=lambda event: getattr(event, "seq", 0))

        storage = get_storage()
        frames: list[dict] = []
        for frame_index, event in enumerate(selected_events, start=1):
            screenshot = screenshots.get(str(event.screenshot_id))
            if screenshot is None:
                continue

            try:
                body, content_type = storage.get_object(screenshot.object_key)
            except Exception as exc:
                print(f"[api] Failed to load SOP vision frame: {exc}")
                continue

            frames.append(
                {
                    "frame_id": f"frame_{frame_index}",
                    "source_event_id": str(event.id),
                    "timestamp_ms": event.timestamp_ms,
                    "application": (getattr(event, "attrs", {}) or {}).get("foreground_app"),
                    "window_title": (getattr(event, "attrs", {}) or {}).get("window_title"),
                    "data_url": (
                        f"data:{content_type};base64,"
                        f"{base64.b64encode(body).decode('ascii')}"
                    ),
                }
            )

        return frames

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
