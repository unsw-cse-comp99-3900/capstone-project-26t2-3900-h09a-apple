"""
S3-compatible object storage client and signed URL helpers.
"""

from __future__ import annotations

import base64
import os
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Protocol
from uuid import UUID

import boto3

from app.session_schema import ScreenshotInput


class ObjectStorage(Protocol):
    def put_object(self, key: str, body: bytes, content_type: str) -> None: ...

    def generate_signed_url(
        self,
        key: str,
        expires: int = 60 * 60 * 24,
    ) -> str: ...


@dataclass(frozen=True)
class UploadedScreenshot:
    object_key: str
    bytes: int


CONTENT_TYPE_EXTENSIONS = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
}


def build_screenshot_object_key(session_id: UUID, screenshot: ScreenshotInput) -> str:
    extension = CONTENT_TYPE_EXTENSIONS[screenshot.content_type]
    return f"sessions/{session_id}/screenshots/{screenshot.id}.{extension}"


def upload_screenshot(
    storage: ObjectStorage,
    session_id: UUID,
    screenshot: ScreenshotInput,
) -> UploadedScreenshot:
    object_key = build_screenshot_object_key(session_id, screenshot)
    body = base64.b64decode(screenshot.data_base64, validate=True)

    storage.put_object(
        key=object_key,
        body=body,
        content_type=screenshot.content_type,
    )

    return UploadedScreenshot(object_key=object_key, bytes=len(body))


class StorageConfigError(RuntimeError):
    pass


def _s3_client(endpoint_url: str | None, access_key: str, secret_key: str, region: str) -> Any:
    return boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name=region,
    )


class S3ObjectStorage:
    """Put via the internal endpoint; sign GET URLs via the browser-reachable endpoint.

    SigV4 binds Host into the signature, so rewriting a URL signed for
    ``minio:9000`` to ``localhost:9000`` breaks verification. Signing with the
    public endpoint keeps Host and signature aligned for the browser.
    """

    def __init__(self, put_client: Any, sign_client: Any, bucket_name: str):
        self.put_client = put_client
        self.sign_client = sign_client
        self.bucket_name = bucket_name

    def put_object(self, key: str, body: bytes, content_type: str) -> None:
        self.put_client.put_object(
            Bucket=self.bucket_name,
            Key=key,
            Body=body,
            ContentType=content_type,
        )

    def generate_signed_url(
        self,
        key: str,
        expires: int = 60 * 60 * 24,
    ) -> str:
        return self.sign_client.generate_presigned_url(
            ClientMethod="get_object",
            Params={
                "Bucket": self.bucket_name,
                "Key": key,
            },
            ExpiresIn=expires,
        )


def get_required_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise StorageConfigError(f"{name} is not configured")
    return value


@lru_cache
def get_storage() -> ObjectStorage:
    bucket_name = get_required_env("S3_BUCKET_NAME")
    access_key = get_required_env("S3_ACCESS_KEY_ID")
    secret_key = get_required_env("S3_SECRET_ACCESS_KEY")
    region = os.getenv("S3_REGION_NAME", "us-east-1")
    internal_endpoint = os.getenv("S3_ENDPOINT_URL") or None
    public_endpoint = os.getenv("S3_PUBLIC_ENDPOINT_URL") or None

    put_client = _s3_client(internal_endpoint, access_key, secret_key, region)
    # Sign with the public endpoint when set so browser Host matches SigV4.
    sign_endpoint = public_endpoint or internal_endpoint
    sign_client = (
        put_client
        if sign_endpoint == internal_endpoint
        else _s3_client(sign_endpoint, access_key, secret_key, region)
    )

    return S3ObjectStorage(
        put_client=put_client,
        sign_client=sign_client,
        bucket_name=bucket_name,
    )
