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

        attrs = self._event_attrs(event)
        for key in ("uia_labeled_by", "uia_help_text"):
            value = attrs.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()

        automation_id = attrs.get("uia_automation_id")
        if isinstance(automation_id, str) and automation_id.strip():
            # Keep readable ids; skip GUID-like noise.
            aid = automation_id.strip()
            if len(aid) <= 48 and any(ch.isalpha() for ch in aid):
                return aid

        candidates = attrs.get("uia_name_candidates")
        if isinstance(candidates, list):
            for entry in candidates:
                if isinstance(entry, str) and entry.strip():
                    return entry.strip()

        return None

    def _control_role(self, event):
        attrs = self._event_attrs(event)
        raw = attrs.get("uia_control_type")
        if not isinstance(raw, str) or not raw.strip():
            return None
        lower = raw.lower()
        if "button" in lower:
            return "button"
        if "hyperlink" in lower or "link" in lower:
            return "link"
        if "menuitem" in lower:
            return "menu item"
        if "tab" in lower:
            return "tab"
        if "edit" in lower:
            return "text field"
        if "listitem" in lower:
            return "list item"
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
        if event_type == EventType.keydown.value:
            return f"Type in {label}" if label else "Use the keyboard"
        if event_type == EventType.clipboard_copy.value:
            return "Copy to clipboard"
        if event_type == EventType.clipboard_paste.value:
            return f"Paste into {label}" if label else "Paste from clipboard"
        if event_type in {
            EventType.file_select.value,
            EventType.file_open.value,
            EventType.file_save.value,
            EventType.file_upload.value,
            EventType.file_download.value,
        }:
            return self._humanize_type(event_type)
        if event_type == EventType.submit.value:
            return f"Submit {label}" if label else "Submit the form"
        if event_type == EventType.tab_switch.value:
            return "Switch tabs"
        if event_type == EventType.window_change.value:
            attrs = self._event_attrs(event)
            to_app = attrs.get("to_app") or attrs.get("foreground_app")
            if isinstance(to_app, str) and to_app.strip():
                return f"Switch to {to_app.strip()}"
            return "Switch application window"
        if event_type == EventType.scroll.value:
            return "Scroll in the application"
        if event_type == EventType.focus_change.value:
            return f"Focus {label}" if label else "Move keyboard focus"

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
            if label:
                role = self._control_role(event)
                if role and role not in label.lower():
                    return f"Click the '{label}' {role}."
                return f"Click '{label}'."
            attrs = self._event_attrs(event)
            app = attrs.get("foreground_app")
            role = self._control_role(event)
            if isinstance(app, str) and app.strip() and role:
                return (
                    f"Click the highlighted {role} in the {app.strip()} window."
                )
            if isinstance(app, str) and app.strip():
                return (
                    f"Click the highlighted control in the {app.strip()} window."
                )
            if role:
                return f"Click the highlighted {role}."
            return "Click the highlighted control."
        if event_type == EventType.input.value:
            if label:
                return f"Type in the '{label}' field."
            return "Type in the highlighted text field."
        if event_type == EventType.keydown.value:
            if label and label.lower() not in {"the focused field", "focused field"}:
                return f"Type in the '{label}' field using the keyboard."
            attrs = self._event_attrs(event)
            app = attrs.get("foreground_app")
            if isinstance(app, str) and app.strip():
                return (
                    f"Click the text field in the {app.strip()} window and type, "
                    f"then continue."
                )
            return "Click the text field and type with the keyboard."
        if event_type == EventType.clipboard_copy.value:
            return "Copy the required content to the clipboard."
        if event_type == EventType.clipboard_paste.value:
            target = label or "the field"
            return f"Paste the clipboard content into {target}."
        if event_type == EventType.file_select.value:
            return "Select the required file."
        if event_type == EventType.file_open.value:
            return "Open the required file."
        if event_type == EventType.file_save.value:
            return "Save the file."
        if event_type == EventType.file_upload.value:
            return "Upload the required file."
        if event_type == EventType.file_download.value:
            return "Download the required file."
        if event_type == EventType.submit.value:
            target = label or "the form"
            return f"Submit {target}."
        if event_type == EventType.tab_switch.value:
            target = page_title or cleaned_url or "the next tab"
            return f"Switch to {target}."
        if event_type == EventType.window_change.value:
            attrs = self._event_attrs(event)
            to_app = attrs.get("to_app") or attrs.get("foreground_app")
            to_title = attrs.get("to_title") or attrs.get("window_title")
            if isinstance(to_app, str) and to_app.strip():
                app = to_app.strip()
                if isinstance(to_title, str) and to_title.strip() and to_title.strip() != app:
                    return f"Bring the '{to_title.strip()}' window of {app} to the front."
                return f"Switch to the {app} application."
            return "Switch to the target application window."
        if event_type == EventType.scroll.value:
            attrs = self._event_attrs(event)
            app = attrs.get("foreground_app")
            where = app.strip() if isinstance(app, str) and app.strip() else "the application"
            return f"Scroll within {where} to reveal the next control."
        if event_type == EventType.focus_change.value:
            target = label or "the next control"
            return f"Move focus to {target}."

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
