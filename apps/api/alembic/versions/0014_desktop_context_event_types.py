"""Expand events.type CHECK for desktop context event types.

Revision ID: 0014_desktop_context_event_types
Revises: 0013_expand_desktop_event_types
Create Date: 2026-07-21
"""

from __future__ import annotations

from alembic import op

revision = "0014_desktop_context_event_types"
down_revision = "0013_expand_desktop_event_types"
branch_labels = None
depends_on = None

NEW_TYPES = (
    "click",
    "navigation",
    "input",
    "submit",
    "tab_switch",
    "keydown",
    "clipboard_copy",
    "clipboard_paste",
    "file_select",
    "file_open",
    "file_save",
    "file_upload",
    "file_download",
    "window_change",
    "scroll",
    "focus_change",
)

OLD_TYPES = (
    "click",
    "navigation",
    "input",
    "submit",
    "tab_switch",
    "keydown",
    "clipboard_copy",
    "clipboard_paste",
    "file_select",
    "file_open",
    "file_save",
    "file_upload",
    "file_download",
)

CONTEXT_TYPES = ("window_change", "scroll", "focus_change")


def _in_list(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{value}'" for value in values)


def upgrade() -> None:
    op.drop_constraint("ck_events_type", "events", type_="check")
    op.create_check_constraint(
        "ck_events_type",
        "events",
        f"type IN ({_in_list(NEW_TYPES)})",
    )


def downgrade() -> None:
    op.execute(
        f"""
        UPDATE events
        SET type = 'navigation'
        WHERE type IN ({_in_list(CONTEXT_TYPES)})
        """
    )
    op.drop_constraint("ck_events_type", "events", type_="check")
    op.create_check_constraint(
        "ck_events_type",
        "events",
        f"type IN ({_in_list(OLD_TYPES)})",
    )
