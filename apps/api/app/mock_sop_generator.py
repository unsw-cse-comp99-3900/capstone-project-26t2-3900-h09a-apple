from app.models import EventType, Session
from app.sop_generator import SopGenerator
from app.sop_schema import SopPayload, SopStep, SopWarning


class MockSopGenerator(SopGenerator):
    # Helper
    def _title(self, index, group):
        for event in group:
            if event.url:
                return event.url
        return f"Step {index + 1}"

    def _instruction(self, group):
        lines = []
        for e in group:
            label = e.target_label or e.target_selector or ""

            lines.append(f"{e.type} {label}".strip())
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
