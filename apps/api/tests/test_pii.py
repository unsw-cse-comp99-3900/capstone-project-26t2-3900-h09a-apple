from app.pii import mask_pii, mask_session_payload
from app.session_schema import SessionPayload


def test_mask_pii_replaces_email():
    assert mask_pii("Contact user@example.com") == "Contact [EMAIL]"


def test_mask_pii_replaces_australian_phone_number():
    assert mask_pii("Call 0412345678") == "Call [PHONE]"


def test_mask_pii_replaces_secret_query_values():
    assert mask_pii("token=abc123 password=hunter2") == "token=[REDACTED] password=[REDACTED]"


def test_mask_pii_leaves_non_sensitive_text_unchanged():
    assert mask_pii("Click the submit button") == "Click the submit button"


def test_mask_session_payload_masks_event_string_fields():
    payload = SessionPayload.model_validate(
        {
            "client_session_id": "11111111-1111-1111-1111-111111111111",
            "workflow_name": "Login flow",
            "started_at": "2026-06-16T12:30:00Z",
            "events": [
                {
                    "type": "input",
                    "target_selector": "#email-user@example.com",
                    "target_label": "Email user@example.com",
                    "value": "user@example.com",
                    "url": "https://example.com/login?token=abc123",
                    "attrs": {
                        "aria_label": "Call 0412345678",
                        "metadata": ["secret=mysecret"],
                    },
                    "timestamp_ms": 1781613000000,
                }
            ],
        }
    )

    masked = mask_session_payload(payload)
    event = masked.events[0]

    assert event.target_selector == "#[EMAIL]"
    assert event.target_label == "Email [EMAIL]"
    assert event.value == "[EMAIL]"
    assert event.url == "https://example.com/login?token=[REDACTED]"
    assert event.attrs == {
        "aria_label": "Call [PHONE]",
        "metadata": ["secret=[REDACTED]"],
    }


def test_mask_session_payload_does_not_mutate_original_payload():
    payload = SessionPayload.model_validate(
        {
            "client_session_id": "11111111-1111-1111-1111-111111111111",
            "workflow_name": "Login flow",
            "started_at": "2026-06-16T12:30:00Z",
            "events": [
                {
                    "type": "input",
                    "value": "user@example.com",
                    "timestamp_ms": 1781613000000,
                }
            ],
        }
    )

    masked = mask_session_payload(payload)

    assert payload.events[0].value == "user@example.com"
    assert masked.events[0].value == "[EMAIL]"
