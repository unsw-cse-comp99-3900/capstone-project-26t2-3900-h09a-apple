"""
In-app notification hub and email fallback for new voice feedback.
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import asdict, dataclass
from uuid import UUID

from fastapi import WebSocket
from sqlalchemy.orm import Session as DBSession

from app.email.sender import EmailSender, OutboundEmail, get_email_sender
from app.models import FeedbackNotification, User, UserRole, VoiceFeedback
from app.settings import get_web_base_url

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class NotificationPushPayload:
    event: str
    notification_id: str
    feedback_id: str
    title: str
    body: str
    review_path: str


class NotificationHub:
    """In-memory WebSocket fan-out for per-user feedback notifications."""

    def __init__(self) -> None:
        """Create an empty connection map."""
        self._connections: dict[UUID, set[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, user_id: UUID, websocket: WebSocket) -> None:
        """Accept a socket and register it under the user id."""
        await websocket.accept()
        async with self._lock:
            self._connections.setdefault(user_id, set()).add(websocket)

    async def disconnect(self, user_id: UUID, websocket: WebSocket) -> None:
        """Drop a socket; remove the user entry when none remain."""
        async with self._lock:
            sockets = self._connections.get(user_id)
            if not sockets:
                return
            sockets.discard(websocket)
            if not sockets:
                self._connections.pop(user_id, None)

    def has_connection(self, user_id: UUID) -> bool:
        """True when the user currently has at least one open socket."""
        return bool(self._connections.get(user_id))

    async def push(self, user_id: UUID, payload: NotificationPushPayload) -> bool:
        """Send JSON to all sockets for the user; return whether any delivered."""
        async with self._lock:
            sockets = list(self._connections.get(user_id, set()))
        if not sockets:
            return False

        message = json.dumps(asdict(payload))
        delivered = False
        for socket in sockets:
            try:
                await socket.send_text(message)
                delivered = True
            except Exception:
                logger.exception("Failed to push notification over WebSocket")
                await self.disconnect(user_id, socket)
        return delivered


notification_hub = NotificationHub()


def build_feedback_uploaded_email(
    *,
    to: str,
    employee_email: str,
    sop_title: str,
    feedback_id: UUID,
) -> OutboundEmail:
    """Build the reviewer/manager email for a newly uploaded voice feedback."""
    base = get_web_base_url().rstrip("/")
    review_url = f"{base}/review?tab=feedback&feedbackId={feedback_id}"
    subject = f"Voice feedback on {sop_title}"
    text_body = (
        f"Employee {employee_email} uploaded feedback on {sop_title}.\n\n"
        f"Open the review panel:\n{review_url}\n"
    )
    html_body = (
        "<!doctype html><html lang='en'><body>"
        f"<p>Employee <strong>{employee_email}</strong> uploaded feedback on "
        f"<strong>{sop_title}</strong>.</p>"
        f"<p><a href='{review_url}'>Open review panel</a></p>"
        "</body></html>"
    )
    return OutboundEmail(
        to=to,
        subject=subject,
        text_body=text_body,
        html_body=html_body,
    )


def list_feedback_recipients(
    db: DBSession,
    *,
    tenant_id: UUID,
    exclude_user_id: UUID,
) -> list[User]:
    """Reviewers and managers in the tenant, excluding the uploading employee."""
    return (
        db.query(User)
        .filter(
            User.tenant_id == tenant_id,
            User.id != exclude_user_id,
            User.role.in_([UserRole.reviewer.value, UserRole.manager.value]),
        )
        .all()
    )


async def notify_feedback_uploaded(
    db: DBSession,
    *,
    feedback: VoiceFeedback,
    employee_email: str,
    sop_title: str,
    email_sender: EmailSender | None = None,
) -> list[FeedbackNotification]:
    """Create in-app notifications and email recipients about new feedback."""
    recipients = list_feedback_recipients(
        db,
        tenant_id=feedback.tenant_id,
        exclude_user_id=feedback.employee_id,
    )
    sender = email_sender or get_email_sender()
    review_path = f"/review?tab=feedback&feedbackId={feedback.id}"
    title = f"Employee {employee_email} uploaded feedback on {sop_title}"
    body = "Open the review panel to play audio and read the transcript."
    created: list[FeedbackNotification] = []

    for recipient in recipients:
        row = FeedbackNotification(
            tenant_id=feedback.tenant_id,
            recipient_id=recipient.id,
            feedback_id=feedback.id,
            event_type="feedback.uploaded",
            title=title,
            body=body,
            delivered_via="inbox",
        )
        db.add(row)
        created.append(row)

    db.flush()

    for row in created:
        payload = NotificationPushPayload(
            event="feedback.uploaded",
            notification_id=str(row.id),
            feedback_id=str(feedback.id),
            title=title,
            body=body,
            review_path=review_path,
        )
        if await notification_hub.push(row.recipient_id, payload):
            row.delivered_via = "websocket"
            continue

        recipient = next(r for r in recipients if r.id == row.recipient_id)
        mail = build_feedback_uploaded_email(
            to=recipient.email,
            employee_email=employee_email,
            sop_title=sop_title,
            feedback_id=feedback.id,
        )
        try:
            sender.send(
                to=mail.to,
                subject=mail.subject,
                text_body=mail.text_body,
                html_body=mail.html_body,
            )
            row.delivered_via = "email"
        except Exception:
            logger.exception("Email fallback failed for feedback notification")
            row.delivered_via = "inbox"

    return created
