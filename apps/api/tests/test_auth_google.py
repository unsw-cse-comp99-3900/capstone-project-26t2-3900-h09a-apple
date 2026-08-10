from __future__ import annotations

import io
import json
from urllib.error import HTTPError, URLError

import pytest

from app.auth import google as google_auth


def test_build_google_authorization_url_with_and_without_state(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "client-123")

    bare = google_auth.build_google_authorization_url("http://localhost/callback")
    assert "client_id=client-123" in bare
    assert "redirect_uri=http%3A%2F%2Flocalhost%2Fcallback" in bare
    assert "state=" not in bare

    with_state = google_auth.build_google_authorization_url(
        "http://localhost/callback", state="nonce"
    )
    assert "state=nonce" in with_state


def test_load_json_raises_google_auth_error(monkeypatch):
    def boom(_request, timeout=10):
        raise URLError("offline")

    monkeypatch.setattr(google_auth, "urlopen", boom)

    with pytest.raises(google_auth.GoogleAuthError, match="Google OAuth request failed"):
        google_auth._load_json("https://example.com")


def test_exchange_google_code_for_id_token_success(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "client-123")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "secret-456")

    class _Resp:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self):
            return json.dumps({"id_token": "tok-abc"}).encode()

    monkeypatch.setattr(google_auth, "urlopen", lambda *a, **k: _Resp())

    assert google_auth.exchange_google_code_for_id_token("code", "http://cb") == "tok-abc"


def test_exchange_google_code_for_id_token_missing_token(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "client-123")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "secret-456")

    class _Resp:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self):
            return json.dumps({"access_token": "x"}).encode()

    monkeypatch.setattr(google_auth, "urlopen", lambda *a, **k: _Resp())

    with pytest.raises(google_auth.GoogleAuthError, match="did not include an ID token"):
        google_auth.exchange_google_code_for_id_token("code", "http://cb")


def test_verify_google_id_token_success(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "client-123")

    class _Resp:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self):
            return json.dumps(
                {
                    "aud": "client-123",
                    "email_verified": "true",
                    "email": " User@Example.COM ",
                }
            ).encode()

    monkeypatch.setattr(google_auth, "urlopen", lambda *a, **k: _Resp())

    identity = google_auth.verify_google_id_token("id-token")
    assert identity.email == "user@example.com"


def test_verify_google_id_token_rejects_bad_audience(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "client-123")

    class _Resp:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self):
            return json.dumps({"aud": "other", "email_verified": True, "email": "a@b.com"}).encode()

    monkeypatch.setattr(google_auth, "urlopen", lambda *a, **k: _Resp())

    with pytest.raises(google_auth.GoogleAuthError, match="audience mismatch"):
        google_auth.verify_google_id_token("id-token")


def test_verify_google_id_token_rejects_unverified_email(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "client-123")

    class _Resp:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self):
            return json.dumps(
                {"aud": "client-123", "email_verified": False, "email": "a@b.com"}
            ).encode()

    monkeypatch.setattr(google_auth, "urlopen", lambda *a, **k: _Resp())

    with pytest.raises(google_auth.GoogleAuthError, match="not verified"):
        google_auth.verify_google_id_token("id-token")


def test_verify_google_id_token_rejects_missing_email(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "client-123")

    class _Resp:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self):
            return json.dumps({"aud": "client-123", "email_verified": True}).encode()

    monkeypatch.setattr(google_auth, "urlopen", lambda *a, **k: _Resp())

    with pytest.raises(google_auth.GoogleAuthError, match="did not include an email"):
        google_auth.verify_google_id_token("id-token")


def test_load_json_http_error(monkeypatch):
    def boom(_request, timeout=10):
        raise HTTPError("https://x", 500, "err", hdrs=None, fp=io.BytesIO(b"bad"))

    monkeypatch.setattr(google_auth, "urlopen", boom)

    with pytest.raises(google_auth.GoogleAuthError):
        google_auth._load_json("https://example.com")
