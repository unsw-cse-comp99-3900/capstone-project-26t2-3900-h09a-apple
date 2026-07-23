from urllib.parse import urlparse

from app.models import EventType, Session
from app.sop_generator import SopGenerator
from app.sop_schema import SopPayload, SopStep, SopWarning


class MockSopGenerator(SopGenerator):
    def _event_attrs(self, event):
        attrs = getattr(event, "attrs", None)
        if isinstance(attrs, dict):
            return attrs
        return {}

    def _page_title(self, event):
        title = self._event_attrs(event).get("page_title")
        if isinstance(title, str) and title.strip():
            return title.strip()
        return None

    def _clean_url(self, url):
        if not url:
            return None

        parsed = urlparse(url)
        if not parsed.netloc:
            return url.strip() or None

        path = parsed.path.rstrip("/")
        return f"{parsed.netloc}{path}" if path else parsed.netloc

    def _label(self, event):
        label = getattr(event, "target_label", None) or getattr(event, "target_selector", None)
        if isinstance(label, str) and label.strip():
            return label.strip()
        return None

    def _humanize_type(self, event_type):
        return str(event_type).replace("_", " ").strip().capitalize()

    def _action_title(self, event):
        label = self._label(event)
        event_type = getattr(event, "type", "")

        if event_type == EventType.click.value:
            return f"Click {label}" if label else "Click the control"
        if event_type == EventType.input.value:
            return f"Enter {label}" if label else "Enter information"
        if event_type == EventType.submit.value:
            return f"Submit {label}" if label else "Submit the form"
        if event_type == EventType.tab_switch.value:
            return "Switch tabs"

        return self._humanize_type(event_type)

    def _title(self, index, group):
        for event in group:
            page_title = self._page_title(event)
            if page_title:
                return page_title

        for event in group:
            if getattr(event, "type", None) != EventType.navigation.value:
                return self._action_title(event)

        for event in group:
            cleaned_url = self._clean_url(getattr(event, "url", None))
            if cleaned_url:
                return cleaned_url

        return f"Step {index + 1}"

    def _instruction_for_event(self, event):
        event_type = getattr(event, "type", "")
        label = self._label(event)
        page_title = self._page_title(event)
        cleaned_url = self._clean_url(getattr(event, "url", None))

        if event_type == EventType.navigation.value:
            destination = page_title or cleaned_url or "the page"
            return f"Open {destination}."
        if event_type == EventType.click.value:
            target = label or "the highlighted control"
            return f"Click {target}."
        if event_type == EventType.input.value:
            target = label or "the field"
            return f"Enter the required information in the {target} field."
        if event_type == EventType.submit.value:
            target = label or "the form"
            return f"Submit {target}."
        if event_type == EventType.tab_switch.value:
            target = page_title or cleaned_url or "the next tab"
            return f"Switch to {target}."

        action = self._humanize_type(event_type).lower() or "continue"
        target = f" on {label}" if label else ""
        return f"{action.capitalize()}{target}."

    def _instruction(self, group):
        lines = []
        for e in group:
            lines.append(self._instruction_for_event(e))
        return "\n".join(lines)

    def _detect_repeat(self, group):
        previous = None
        for e in group:
            current = (
                e.type,
                e.target_label,
            )

            if current == previous:
                return SopWarning(
                    type="repeated_action",
                    message="Repeated action detected",
                    source_event_ids=[str(e.id)],
                )

            previous = current
        return None

    def _semantic_target(self, action):
        targets = action.get("targets") or []
        for target in reversed(targets):
            label = target.get("label")
            if label:
                return label
        return "the relevant control"

    def _semantic_step(self, index, action):
        action_type = action.get("action_type", "interaction")
        target = self._semantic_target(action)
        values = action.get("input_values") or []

        if action_type == "input_and_submit":
            title = f"Complete {target}"
            instruction = f"Enter the required information in {target}, then submit it."
        elif action_type == "input":
            title = f"Enter information in {target}"
            instruction = f"Enter the required information in {target}."
        elif action_type == "submit":
            title = f"Submit {target}"
            instruction = f"Submit {target}."
        elif action_type == "navigation":
            destination = (action.get("page_titles") or action.get("urls") or [target])[0]
            title = f"Open {destination}"
            instruction = f"Navigate to {destination}."
        elif action_type == "tab_switch":
            title = "Switch to the required window"
            instruction = f"Switch to {action.get('window_title') or target}."
        elif action_type == "repeated_click":
            title = f"Select {target}"
            instruction = f"Select {target} once."
        elif action_type == "interaction_sequence":
            title = f"Use {target}"
            instruction = f"Use the relevant controls to continue to {target}."
        else:
            title = f"Select {target}"
            instruction = f"Select {target}."

        if values and action_type in {"input", "input_and_submit"}:
            final_value = values[-1]
            instruction = instruction.replace(
                "the required information",
                f'"{final_value}"',
                1,
            )

        duration_ms = int(action.get("duration_ms") or 0)
        time_estimate = 5 if duration_ms <= 0 else min(60, max(1, round(duration_ms / 1000)))
        return SopStep(
            order=index + 1,
            title=title,
            instruction=instruction,
            source_event_ids=list(action.get("source_event_ids") or []),
            time_estimate=time_estimate,
        )

    def generate_from_semantic_actions(self, workflow_name: str, actions: list[dict]):
        if not actions:
            return SopPayload(
                title=workflow_name,
                summary="1 step workflow",
                steps=[
                    SopStep(
                        order=1,
                        title="Review the recorded workflow",
                        instruction="Review the recording and complete the intended task.",
                        source_event_ids=[],
                        time_estimate=None,
                    )
                ],
                warnings=[],
            )

        steps = [
            self._semantic_step(index, action)
            for index, action in enumerate(actions)
        ]
        warnings = [
            SopWarning(
                type="repeated_action",
                message="Repeated action detected",
                source_event_ids=list(action.get("source_event_ids") or []),
            )
            for action in actions
            if action.get("action_type") == "repeated_click"
        ]
        return SopPayload(
            title=workflow_name,
            summary=f"{len(steps)} step workflow",
            steps=steps,
            warnings=warnings,
        )

    def generate(self, session: Session):
        events = sorted(session.events, key=lambda e: e.seq)

        groups = []
        current = []

        for event in events:
            if event.type == EventType.navigation.value:
                if current:
                    groups.append(current)

                current = [event]

            else:
                current.append(event)

        if current:
            groups.append(current)

        steps = []
        warnings = []

        for i, group in enumerate(groups):
            steps.append(
                SopStep(
                    order=i + 1,
                    title=self._title(i, group),
                    instruction=self._instruction(group),
                    source_event_ids=[str(e.id) for e in group],
                    time_estimate=5,
                )
            )

            warning = self._detect_repeat(group)

            if warning:
                warnings.append(warning)

        return SopPayload(
            title=session.workflow_name,
            summary=f"{len(steps)} step workflow",
            steps=steps,
            warnings=warnings,
        )
