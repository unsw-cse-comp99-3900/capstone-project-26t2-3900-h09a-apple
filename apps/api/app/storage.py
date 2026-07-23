from __future__ import annotations

import base64
import os
from dataclasses import dataclass
from functools import lru_cache
from typing import Protocol
from uuid import UUID

import boto3

from app.session_schema import ScreenshotInput


class ObjectStorage(Protocol):
    def put_object(self, key: str, body: bytes, content_type: str) -> None: ...

    def get_object(self, key: str) -> tuple[bytes, str]: ...

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


class S3ObjectStorage:
    def __init__(self, client, bucket_name: str):
        self.client = client
        self.bucket_name = bucket_name

    def put_object(self, key: str, body: bytes, content_type: str) -> None:
        self.client.put_object(
            Bucket=self.bucket_name,
            Key=key,
            Body=body,
            ContentType=content_type,
        )

    def get_object(self, key: str) -> tuple[bytes, str]:
        response = self.client.get_object(Bucket=self.bucket_name, Key=key)
        body = response["Body"].read()
        content_type = response.get("ContentType") or "image/jpeg"
        return body, content_type

    def generate_signed_url(
        self,
        key: str,
        expires: int = 60 * 60 * 24,
    ) -> str:
        return self.client.generate_presigned_url(
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

    client = boto3.client(
        "s3",
        endpoint_url=os.getenv("S3_ENDPOINT_URL"),
        aws_access_key_id=get_required_env("S3_ACCESS_KEY_ID"),
        aws_secret_access_key=get_required_env("S3_SECRET_ACCESS_KEY"),
        region_name=os.getenv("S3_REGION_NAME", "us-east-1"),
    )

    return S3ObjectStorage(client=client, bucket_name=bucket_name)
