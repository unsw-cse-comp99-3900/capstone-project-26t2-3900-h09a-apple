"""Expand events.type CHECK for desktop recorder event types.

Revision ID: 0013_expand_desktop_event_types
Revises: 0012_workflow_clustering
Create Date: 2026-07-21
"""

from __future__ import annotations

from alembic import op

revision = "0013_expand_desktop_event_types"
down_revision = "0012_workflow_clustering"
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
)

OLD_TYPES = (
    "click",
    "navigation",
    "input",
    "submit",
    "tab_switch",
)


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
        """
        UPDATE events
        SET type = 'input'
        WHERE type IN (
            'keydown',
            'clipboard_copy',
            'clipboard_paste',
            'file_select',
            'file_open',
            'file_save',
            'file_upload',
            'file_download'
        )
        """
    )
    op.drop_constraint("ck_events_type", "events", type_="check")
    op.create_check_constraint(
        "ck_events_type",
        "events",
        f"type IN ({_in_list(OLD_TYPES)})",
    )
