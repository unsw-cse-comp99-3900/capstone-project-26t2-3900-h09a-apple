from __future__ import annotations

import os
from uuid import UUID

from dotenv import load_dotenv

load_dotenv()


class SettingsError(RuntimeError):
    pass


def get_default_tenant_id() -> UUID:
    raw_tenant_id = os.getenv("DEFAULT_TENANT_ID")
    if not raw_tenant_id:
        raise SettingsError("DEFAULT_TENANT_ID is not configured")

    try:
        return UUID(raw_tenant_id)
    except ValueError as exc:
        raise SettingsError("DEFAULT_TENANT_ID must be a valid UUID") from exc
