from uuid import UUID

from app.session_schema import ScreenshotInput
from app.storage import build_screenshot_object_key, upload_screenshot


class FakeStorage:
    def __init__(self):
        self.uploads = []

    def put_object(self, key: str, body: bytes, content_type: str) -> None:
        self.uploads.append(
            {
                "key": key,
                "body": body,
                "content_type": content_type,
            }
        )


def test_build_screenshot_object_key_uses_session_and_screenshot_ids():
    session_id = UUID("11111111-1111-1111-1111-111111111111")
    screenshot = ScreenshotInput.model_validate(
        {
            "id": "33333333-3333-3333-3333-333333333333",
            "data_base64": "ZmFrZS1wbmctYnl0ZXM=",
            "content_type": "image/png",
        }
    )

    assert (
        build_screenshot_object_key(session_id, screenshot)
        == "sessions/11111111-1111-1111-1111-111111111111/"
        "screenshots/33333333-3333-3333-3333-333333333333.png"
    )


def test_upload_screenshot_decodes_base64_and_uploads_bytes():
    storage = FakeStorage()
    session_id = UUID("11111111-1111-1111-1111-111111111111")
    screenshot = ScreenshotInput.model_validate(
        {
            "id": "33333333-3333-3333-3333-333333333333",
            "data_base64": "ZmFrZS1wbmctYnl0ZXM=",
            "content_type": "image/png",
        }
    )

    uploaded = upload_screenshot(storage, session_id, screenshot)

    assert uploaded.object_key == storage.uploads[0]["key"]
    assert uploaded.bytes == len(b"fake-png-bytes")
    assert storage.uploads[0]["body"] == b"fake-png-bytes"
    assert storage.uploads[0]["content_type"] == "image/png"
