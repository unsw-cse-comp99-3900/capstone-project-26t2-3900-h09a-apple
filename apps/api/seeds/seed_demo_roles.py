"""Create REVIEWER and MANAGER demo accounts for local Compose assessment.

Self-service registration always creates EMPLOYEE. Run inside the API container
after migrate has completed:

    docker compose exec -T api python seeds/seed_demo_roles.py

Password is taken from DEMO_ROLE_PASSWORD (required). Set it in the root .env
used by Compose; see .env.example and DEPLOYMENT_GUIDE.md. Never commit real
production credentials.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from uuid import UUID

ACCOUNTS = (
    ("reviewer@work.com", "REVIEWER"),
    ("manager@work.com", "MANAGER"),
)


def _ensure_app_on_path() -> None:
    # When invoked as `python seeds/seed_demo_roles.py`, sys.path[0] is seeds/.
    app_root = Path(__file__).resolve().parents[1]
    app_root_str = str(app_root)
    if app_root_str not in sys.path:
        sys.path.insert(0, app_root_str)


def _demo_password() -> str:
    password = os.getenv("DEMO_ROLE_PASSWORD", "").strip()
    if not password:
        print(
            "DEMO_ROLE_PASSWORD is not set. Add it to the root .env "
            "(see .env.example) and recreate the API container, then retry.",
            file=sys.stderr,
        )
        raise SystemExit(1)
    return password


def main() -> None:
    _ensure_app_on_path()

    from app import models
    from app.auth.password import hash_password
    from app.database import get_sessionmaker

    tenant_id = UUID(os.getenv("DEFAULT_TENANT_ID", "22222222-2222-2222-2222-222222222222"))
    password = _demo_password()
    role_by_name = {
        "REVIEWER": models.UserRole.reviewer,
        "MANAGER": models.UserRole.manager,
    }

    db = get_sessionmaker()()
    try:
        hashed = hash_password(password)
        for email, role_name in ACCOUNTS:
            role = role_by_name[role_name]
            user = db.query(models.User).filter(models.User.email == email).one_or_none()
            if user is None:
                user = models.User(
                    email=email,
                    hashed_password=hashed,
                    role=role.value,
                    tenant_id=tenant_id,
                )
                db.add(user)
                action = "created"
            else:
                user.hashed_password = hashed
                user.role = role.value
                user.tenant_id = tenant_id
                action = "updated"
            db.flush()
            print(f"{action}: {email} role={role.value}")
        db.commit()
        print("password source: DEMO_ROLE_PASSWORD (value not printed)")
    finally:
        db.close()


if __name__ == "__main__":
    main()
