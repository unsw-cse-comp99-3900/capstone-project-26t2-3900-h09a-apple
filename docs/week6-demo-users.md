# Week 6 Demo Users

Self-service registration always creates `EMPLOYEE` users in the server configured
default tenant. Reviewer and manager demo accounts must be created directly in
the database until an admin role-management flow exists.

## Preferred path (Docker Compose)

After the API container is healthy:

```bash
docker compose exec -T api python seeds/seed_demo_roles.py
```

Requires `DEMO_ROLE_PASSWORD` in the root `.env` (passed into the API
container). Stock assessor value from `.env.example` is `11112222`.

| Email               | Password   | Role     |
| ------------------- | ---------- | -------- |
| `reviewer@work.com` | `11112222` | REVIEWER |
| `manager@work.com`  | `11112222` | MANAGER  |

See `DEPLOYMENT_GUIDE.md` for the full assessor quick start (MinIO, extension,
smoke path).

## Manual SQL path (optional)

Generate password hashes with the API password helper on a host with the API
venv, or inside the API container:

```bash
docker compose exec -T api python -c "import os; from app.auth.password import hash_password; print(hash_password(os.environ['DEMO_ROLE_PASSWORD']))"
```

Then insert or update the demo users. Replace `<password-hash>` with the value
printed above and `<tenant-id>` with `DEFAULT_TENANT_ID` (default
`22222222-2222-2222-2222-222222222222`).

```sql
INSERT INTO users (id, email, hashed_password, role, tenant_id, created_at)
VALUES
  (
    gen_random_uuid(),
    'reviewer@work.com',
    '<password-hash>',
    'REVIEWER',
    '<tenant-id>',
    NOW()
  ),
  (
    gen_random_uuid(),
    'manager@work.com',
    '<password-hash>',
    'MANAGER',
    '<tenant-id>',
    NOW()
  )
ON CONFLICT (email) DO UPDATE
SET
  hashed_password = EXCLUDED.hashed_password,
  role = EXCLUDED.role,
  tenant_id = EXCLUDED.tenant_id;
```
