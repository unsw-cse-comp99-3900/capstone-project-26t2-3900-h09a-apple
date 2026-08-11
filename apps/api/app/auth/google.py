"""
Google OAuth code exchange and ID-token verification helpers.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from app.settings import get_google_client_id, get_google_client_secret

GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
GOOGLE_TOKENINFO_ENDPOINT = "https://oauth2.googleapis.com/tokeninfo"


class GoogleAuthError(Exception):
    """Raised when Google's OAuth response cannot be trusted."""


@dataclass(frozen=True)
class GoogleIdentity:
    email: str


def build_google_authorization_url(redirect_uri: str, state: str | None = None) -> str:
    params = {
        "client_id": get_google_client_id(),
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "offline",
        "prompt": "select_account",
    }

    if state:
        params["state"] = state

    return f"{GOOGLE_AUTHORIZATION_ENDPOINT}?{urlencode(params)}"


def _load_json(request: Request | str) -> dict:
    try:
        with urlopen(request, timeout=10) as response:
            return json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise GoogleAuthError("Google OAuth request failed") from exc


def exchange_google_code_for_id_token(code: str, redirect_uri: str) -> str:
    payload = urlencode(
        {
            "code": code,
            "client_id": get_google_client_id(),
            "client_secret": get_google_client_secret(),
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        }
    ).encode("utf-8")

    request = Request(
        GOOGLE_TOKEN_ENDPOINT,
        data=payload,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )

    body = _load_json(request)
    id_token = body.get("id_token")

    if not isinstance(id_token, str) or not id_token:
        raise GoogleAuthError("Google OAuth response did not include an ID token")

    return id_token


def verify_google_id_token(id_token: str) -> GoogleIdentity:
    body = _load_json(f"{GOOGLE_TOKENINFO_ENDPOINT}?{urlencode({'id_token': id_token})}")

    if body.get("aud") != get_google_client_id():
        raise GoogleAuthError("Google ID token audience mismatch")

    email_verified = body.get("email_verified")
    if email_verified is not True and str(email_verified).lower() != "true":
        raise GoogleAuthError("Google email is not verified")

    email = body.get("email")
    if not isinstance(email, str) or not email:
        raise GoogleAuthError("Google ID token did not include an email")

    return GoogleIdentity(email=email.strip().lower())
