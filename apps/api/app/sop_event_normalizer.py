from __future__ import annotations

from collections import Counter
from math import ceil
from typing import Any

MAX_LABEL_LENGTH = 120
MAX_WINDOW_TITLE_LENGTH = 160
MAX_VALUE_LENGTH = 500
MAX_TARGETS_PER_GROUP = 5
MAX_VALUES_PER_GROUP = 3
MAX_EVENTS_PER_GROUP = 250
MAX_ACTION_GROUPS = 60
GROUP_GAP_MS = 5_000

GENERIC_STRUCTURAL_LABELS = {
    "",
    "code",
    "group",
    "image",
    "main",
    "main pane",
    "pane",
    "region",
    "system tray",
    "taskbar",
    "区域",
    "图像",
    "组",
}


def _short_text(value: object, limit: int) -> str | None:
    if value is None:
        return None

    text = " ".join(str(value).split()).strip()
    if not text:
        return None
    if len(text) <= limit:
        return text
    return f"{text[: limit - 3]}..."


def _short_value(value: object, limit: int) -> str | None:
    if value is None:
        return None

    text = str(value).replace("\r\n", "\n").replace("\r", "\n").strip()
    if not text:
        return None
    if len(text) <= limit:
        return text
    return f"{text[: limit - 3]}..."


def _event_type(event: object) -> str:
    raw_type = getattr(event, "type", "")
    return str(getattr(raw_type, "value", raw_type))


def _event_attrs(event: object) -> dict[str, Any]:
    attrs = getattr(event, "attrs", None)
    return attrs if isinstance(attrs, dict) else {}


def _desktop_target(attrs: dict[str, Any]) -> dict[str, Any]:
    target = attrs.get("desktop_target")
    return target if isinstance(target, dict) else {}


def _event_view(event: object) -> dict[str, Any]:
    attrs = _event_attrs(event)
    desktop_target = _desktop_target(attrs)
    is_password = attrs.get("is_password") is True or desktop_target.get("is_password") is True
    timestamp_ms = int(getattr(event, "timestamp_ms", 0) or 0)
    target_label = (
        None
        if is_password
        else _short_text(getattr(event, "target_label", None), MAX_LABEL_LENGTH)
    )

    if target_label is None and not is_password:
        target_label = _short_text(
            desktop_target.get("name")
            or desktop_target.get("automation_id")
            or desktop_target.get("localized_control_type"),
            MAX_LABEL_LENGTH,
        )

    value = (
        None
        if is_password
        else _short_value(getattr(event, "value", None), MAX_VALUE_LENGTH)
    )

    return {
        "id": str(getattr(event, "id")),
        "seq": int(getattr(event, "seq", 0) or 0),
        "type": _event_type(event),
        "timestamp_ms": timestamp_ms,
        "application": _short_text(attrs.get("foreground_app"), 80),
        "window_title": _short_text(attrs.get("window_title"), MAX_WINDOW_TITLE_LENGTH),
        "page_title": _short_text(attrs.get("page_title"), MAX_WINDOW_TITLE_LENGTH),
        "target_label": target_label,
        "target_selector": (
            None
            if is_password
            else _short_text(getattr(event, "target_selector", None), 240)
        ),
        "control_type": _short_text(desktop_target.get("control_type"), 80),
        "automation_id": (
            None
            if is_password
            else _short_text(desktop_target.get("automation_id"), 120)
        ),
        "value": value,
        "url": _short_text(getattr(event, "url", None), 300),
        "raw_event_type": _short_text(attrs.get("raw_event_type"), 60),
        "screenshot_id": (
            str(getattr(event, "screenshot_id"))
            if getattr(event, "screenshot_id", None) is not None
            else None
        ),
    }


def _context_key(event: dict[str, Any]) -> tuple[str | None, str | None]:
    return event["application"], event["window_title"]


def _target_key(event: dict[str, Any]) -> tuple[str | None, ...]:
    return (
        event["target_selector"],
        event["automation_id"],
        event["target_label"],
        event["control_type"],
    )


def _can_merge(group: list[dict[str, Any]], event: dict[str, Any]) -> bool:
    if not group or len(group) >= MAX_EVENTS_PER_GROUP:
        return False

    previous = group[-1]
    gap_ms = event["timestamp_ms"] - previous["timestamp_ms"]
    if gap_ms < 0 or gap_ms > GROUP_GAP_MS:
        return False
    if _context_key(previous) != _context_key(event):
        return False
    if previous["type"] in {"navigation", "tab_switch", "submit"}:
        return False
    if event["type"] in {"navigation", "tab_switch"}:
        return False

    if event["type"] == "submit":
        return any(item["type"] == "input" for item in group)

    if previous["type"] == "click" and event["type"] == "click":
        return gap_ms <= 3_000

    if event["type"] == "input":
        return previous["type"] in {"click", "input"}

    if previous["type"] == "input" and event["type"] == "click":
        return gap_ms <= 2_000

    return False


def _is_generic_click_group(group: list[dict[str, Any]]) -> bool:
    if not group or any(event["type"] != "click" for event in group):
        return False

    labels = {
        (event["target_label"] or "").strip().casefold()
        for event in group
    }
    return labels.issubset(GENERIC_STRUCTURAL_LABELS)


def _drop_internal_structural_noise(
    groups: list[list[dict[str, Any]]],
) -> list[list[dict[str, Any]]]:
    cleaned: list[list[dict[str, Any]]] = []

    for index, group in enumerate(groups):
        if not _is_generic_click_group(group):
            cleaned.append(group)
            continue

        previous_group = groups[index - 1] if index > 0 else None
        next_group = groups[index + 1] if index + 1 < len(groups) else None
        context = _context_key(group[0])
        surrounded_by_same_context = (
            previous_group is not None
            and next_group is not None
            and _context_key(previous_group[-1]) == context
            and _context_key(next_group[0]) == context
        )

        if not surrounded_by_same_context:
            cleaned.append(group)

    return cleaned


def _target_summary(event: dict[str, Any]) -> dict[str, str] | None:
    target = {
        "label": event["target_label"],
        "selector": event["target_selector"],
        "control_type": event["control_type"],
        "automation_id": event["automation_id"],
    }
    compact = {key: value for key, value in target.items() if value}
    return compact or None


def _action_type(events: list[dict[str, Any]]) -> str:
    types = [event["type"] for event in events]
    if "input" in types and "submit" in types:
        return "input_and_submit"
    if "input" in types:
        return "input"
    if "submit" in types:
        return "submit"
    if "navigation" in types:
        return "navigation"
    if "tab_switch" in types:
        return "tab_switch"
    if types.count("click") > 1:
        unique_targets = {_target_key(event) for event in events}
        return "repeated_click" if len(unique_targets) == 1 else "interaction_sequence"
    return types[0] if types else "interaction"


def _summarize_group(events: list[dict[str, Any]], index: int) -> dict[str, Any]:
    targets: list[dict[str, str]] = []
    seen_targets: set[tuple[tuple[str, str], ...]] = set()
    observed_values: list[str] = []

    for event in events:
        target = _target_summary(event)
        if target and len(targets) < MAX_TARGETS_PER_GROUP:
            fingerprint = tuple(sorted(target.items()))
            if fingerprint not in seen_targets:
                seen_targets.add(fingerprint)
                targets.append(target)

        value = event["value"]
        if value and value not in observed_values:
            observed_values.append(value)

    final_values = [
        value
        for value_index, value in enumerate(observed_values)
        if not any(
            later_value.startswith(value)
            for later_value in observed_values[value_index + 1 :]
        )
    ][-MAX_VALUES_PER_GROUP:]

    type_counts = Counter(event["type"] for event in events)
    started_at_ms = events[0]["timestamp_ms"]
    ended_at_ms = events[-1]["timestamp_ms"]
    urls = list(dict.fromkeys(event["url"] for event in events if event["url"]))
    page_titles = list(
        dict.fromkeys(event["page_title"] for event in events if event["page_title"])
    )

    result: dict[str, Any] = {
        "group_id": f"g{index:03d}",
        "action_type": _action_type(events),
        "application": events[-1]["application"] or events[0]["application"],
        "window_title": events[-1]["window_title"] or events[0]["window_title"],
        "event_type_counts": dict(type_counts),
        "event_count": len(events),
        "source_event_ids": [event["id"] for event in events],
        "started_at_ms": started_at_ms,
        "ended_at_ms": ended_at_ms,
        "duration_ms": max(0, ended_at_ms - started_at_ms),
        "has_screenshot": any(event["screenshot_id"] for event in events),
    }

    if targets:
        result["targets"] = targets
    if final_values:
        result["input_values"] = final_values
    if urls:
        result["urls"] = urls[:3]
    if page_titles:
        result["page_titles"] = page_titles[:3]

    return result


def _coalesce_to_budget(groups: list[list[dict[str, Any]]]) -> list[list[dict[str, Any]]]:
    if len(groups) <= MAX_ACTION_GROUPS:
        return groups

    chunk_size = ceil(len(groups) / MAX_ACTION_GROUPS)
    return [
        [event for group in groups[index : index + chunk_size] for event in group]
        for index in range(0, len(groups), chunk_size)
    ]


def normalize_session_events(events: list[object]) -> list[dict[str, Any]]:
    ordered = sorted(
        events,
        key=lambda event: (
            getattr(event, "seq", 0),
            getattr(event, "timestamp_ms", 0),
        ),
    )
    views = [_event_view(event) for event in ordered]
    groups: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []

    for event in views:
        if current and not _can_merge(current, event):
            groups.append(current)
            current = []

        current.append(event)

        if event["type"] in {"navigation", "tab_switch", "submit"}:
            groups.append(current)
            current = []

    if current:
        groups.append(current)

    groups = _drop_internal_structural_noise(groups)
    groups = _coalesce_to_budget(groups)
    return [_summarize_group(group, index + 1) for index, group in enumerate(groups)]
