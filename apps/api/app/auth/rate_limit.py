from __future__ import annotations

import os
import time
from collections import defaultdict
from threading import Lock

from fastapi import HTTPException, Request, status

_lock = Lock()
_hits: dict[str, list[float]] = defaultdict(list)


def auth_rate_limiter(request: Request) -> None:
    if os.getenv("AUTH_RATE_LIMIT_DISABLED", "").lower() in ("1", "true", "yes"):
        return

    limit = int(os.getenv("AUTH_RATE_LIMIT_MAX", "30"))
    window = int(os.getenv("AUTH_RATE_LIMIT_WINDOW_SECONDS", "60"))

    client = request.client
    ip = client.host if client else "unknown"
    now = time.monotonic()

    with _lock:
        window_start = now - window
        hits = _hits[ip]
        hits[:] = [t for t in hits if t > window_start]
        if len(hits) >= limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests",
            )
        hits.append(now)


def clear_auth_rate_limit_state() -> None:
    """Reset in-memory counters (tests only)."""
    with _lock:
        _hits.clear()
