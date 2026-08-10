"""Create REVIEWER and MANAGER demo accounts for local Compose assessment.

Self-service registration always creates EMPLOYEE. Run inside the API container
after migrate has completed:

    docker compose exec -T api python seeds/seed_demo_roles.py

Default password for both accounts: 11112222
"""

from __future__ import annotations

import os
from uuid import UUID

from app import models
from app.auth.password import hash_password
from app.database import get_sessionmaker

TENANT_ID = UUID(os.getenv("DEFAULT_TENANT_ID", "22222222-2222-2222-2222-222222222222"))
DEMO_PASSWORD = os.getenv("DEMO_ROLE_PASSWORD", "11112222")

ACCOUNTS = (
    ("reviewer@work.com", models.UserRole.reviewer),
    ("manager@work.com", models.UserRole.manager),
)


def main() -> None:
    db = get_sessionmaker()()
    try:
        hashed = hash_password(DEMO_PASSWORD)
        for email, role in ACCOUNTS:
            user = db.query(models.User).filter(models.User.email == email).one_or_none()
            if user is None:
                user = models.User(
                    email=email,
                    hashed_password=hashed,
                    role=role.value,
                    tenant_id=TENANT_ID,
                )
                db.add(user)
                action = "created"
            else:
                user.hashed_password = hashed
                user.role = role.value
                user.tenant_id = TENANT_ID
                action = "updated"
            db.flush()
            print(f"{action}: {email} role={role.value}")
        db.commit()
        print(f"password for both accounts: {DEMO_PASSWORD}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
