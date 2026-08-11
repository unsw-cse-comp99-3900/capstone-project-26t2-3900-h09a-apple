"""
Outbound email sender with mock outbox and SES production path.
"""

from __future__ import annotations

import html
import os
from dataclasses import dataclass
from typing import Protocol

import boto3

from app.settings import SettingsError, get_web_base_url


@dataclass(frozen=True)
class OutboundEmail:
    to: str
    subject: str
    text_body: str
    html_body: str | None = None
    reset_url: str | None = None


class EmailSender(Protocol):
    def send(
        self,
        *,
        to: str,
        subject: str,
        text_body: str,
        html_body: str | None = None,
    ) -> None: ...


_MOCK_OUTBOX: list[OutboundEmail] = []


class MockEmailSender:
    def send(
        self,
        *,
        to: str,
        subject: str,
        text_body: str,
        html_body: str | None = None,
    ) -> None:
        _MOCK_OUTBOX.append(
            OutboundEmail(
                to=to,
                subject=subject,
                text_body=text_body,
                html_body=html_body,
                reset_url=_extract_reset_url(text_body),
            )
        )


class SesEmailSender:
    def __init__(self, *, region: str, from_email: str) -> None:
        self._region = region
        self._from_email = from_email

    def send(
        self,
        *,
        to: str,
        subject: str,
        text_body: str,
        html_body: str | None = None,
    ) -> None:
        client = boto3.client("ses", region_name=self._region)

        body = {"Text": {"Data": text_body, "Charset": "UTF-8"}}
        if html_body:
            body["Html"] = {"Data": html_body, "Charset": "UTF-8"}

        client.send_email(
            Source=self._from_email,
            Destination={"ToAddresses": [to]},
            Message={
                "Subject": {"Data": subject, "Charset": "UTF-8"},
                "Body": body,
            },
        )


def clear_mock_email_outbox() -> None:
    _MOCK_OUTBOX.clear()


def get_mock_email_outbox() -> list[OutboundEmail]:
    return list(_MOCK_OUTBOX)


def get_email_provider() -> str:
    return os.getenv("EMAIL_PROVIDER", "mock").strip().lower()


def is_mock_outbox_available() -> bool:
    provider = get_email_provider()
    environment = os.getenv("APP_ENV", os.getenv("ENVIRONMENT", "local")).strip().lower()
    return provider in {"", "mock"} and environment not in {"prod", "production"}


def _extract_reset_url(text_body: str) -> str | None:
    for line in text_body.splitlines():
        value = line.strip()
        if "/reset-password?token=" in value:
            return value
    return None


def get_email_sender() -> EmailSender:
    provider = get_email_provider()
    if provider in {"", "mock"}:
        return MockEmailSender()
    if provider != "ses":
        raise SettingsError(f"Unsupported EMAIL_PROVIDER: {provider}")

    region = os.getenv("AWS_SES_REGION", "").strip()
    from_email = os.getenv("AWS_SES_FROM_EMAIL", "").strip()
    if not region:
        raise SettingsError("AWS_SES_REGION is not configured")
    if not from_email:
        raise SettingsError("AWS_SES_FROM_EMAIL is not configured")
    return SesEmailSender(region=region, from_email=from_email)


def build_password_reset_email(*, to: str, raw_token: str) -> OutboundEmail:
    base = get_web_base_url().rstrip("/")
    reset_url = f"{base}/reset-password?token={raw_token}"
    escaped_reset_url = html.escape(reset_url, quote=True)

    text_body = (
        "Reset your WorkTrace password\n\n"
        "Use this link to set a new password for your WorkTrace account. "
        "It expires in 30 minutes:\n\n"
        f"{reset_url}\n\n"
        "If you use Google sign-in and want to add a password, this link also works for that.\n\n"
        "If you did not request a password reset, you can ignore this email."
    )

    html_body = (
        "<!doctype html>"
        '<html lang="en">'
        '<body style="margin:0;background:#f6f8ff;font-family:Arial,Helvetica,sans-serif;color:#17213d;">'
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f8ff;padding:32px 16px;">'
        '<tr><td align="center">'
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e1e6f6;border-radius:16px;padding:32px;">'
        '<tr><td style="font-size:13px;font-weight:700;letter-spacing:0.16em;color:#6570a8;text-transform:uppercase;">WorkTrace</td></tr>'
        '<tr><td style="padding-top:20px;font-size:26px;font-weight:800;line-height:1.2;">Reset your password</td></tr>'
        '<tr><td style="padding-top:12px;font-size:16px;line-height:1.6;color:#445071;">'
        "Use the button below to set a new password. This link expires in 30 minutes. "
        "If you use Google sign-in and want to add a password, this link also works for that."
        "</td></tr>"
        '<tr><td style="padding-top:24px;">'
        f'<a href="{escaped_reset_url}" style="display:inline-block;background:#6366f1;color:#ffffff;text-decoration:none;font-weight:700;border-radius:10px;padding:12px 18px;">Reset password</a>'
        "</td></tr>"
        '<tr><td style="padding-top:24px;font-size:13px;line-height:1.6;color:#66708f;">'
        "If the button does not work, copy and paste this link into your browser:<br>"
        f'<a href="{escaped_reset_url}" style="color:#4f46e5;">{escaped_reset_url}</a>'
        "</td></tr>"
        '<tr><td style="padding-top:24px;font-size:13px;line-height:1.6;color:#66708f;">'
        "If you did not request this reset, you can ignore this email."
        "</td></tr>"
        "</table>"
        "</td></tr>"
        "</table>"
        "</body></html>"
    )

    return OutboundEmail(
        to=to,
        subject="Reset your WorkTrace password",
        text_body=text_body,
        html_body=html_body,
        reset_url=reset_url,
    )
