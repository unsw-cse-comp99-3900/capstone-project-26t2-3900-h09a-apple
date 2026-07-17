from __future__ import annotations

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


class EmailSender(Protocol):
    def send(self, *, to: str, subject: str, text_body: str) -> None: ...


_MOCK_OUTBOX: list[OutboundEmail] = []


class MockEmailSender:
    def send(self, *, to: str, subject: str, text_body: str) -> None:
        _MOCK_OUTBOX.append(OutboundEmail(to=to, subject=subject, text_body=text_body))


class SesEmailSender:
    def __init__(self, *, region: str, from_email: str) -> None:
        self._region = region
        self._from_email = from_email

    def send(self, *, to: str, subject: str, text_body: str) -> None:
        client = boto3.client("ses", region_name=self._region)
        client.send_email(
            Source=self._from_email,
            Destination={"ToAddresses": [to]},
            Message={
                "Subject": {"Data": subject, "Charset": "UTF-8"},
                "Body": {"Text": {"Data": text_body, "Charset": "UTF-8"}},
            },
        )


def clear_mock_email_outbox() -> None:
    _MOCK_OUTBOX.clear()


def get_mock_email_outbox() -> list[OutboundEmail]:
    return list(_MOCK_OUTBOX)


def get_email_sender() -> EmailSender:
    provider = os.getenv("EMAIL_PROVIDER", "mock").strip().lower()
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
    text_body = (
        "Reset your WorkTrace password using this link (expires in 30 minutes):\n\n"
        f"{reset_url}\n\n"
        "If you did not request a password reset, you can ignore this email."
    )
    return OutboundEmail(
        to=to,
        subject="Reset your WorkTrace password",
        text_body=text_body,
    )
