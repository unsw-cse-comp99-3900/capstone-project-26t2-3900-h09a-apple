# Week 6 Demo Users

Self-service registration always creates `EMPLOYEE` users in the server configured
default tenant. Reviewer and manager demo accounts must be created directly in
the database until an admin role-management flow exists.

Generate password hashes with the API password helper:

```bash
cd apps/api
python -c "from app.auth.password import hash_password; print(hash_password('change-me'))"
```

Then insert or update the demo users in the target database. Replace
`<tenant-id>` with `DEFAULT_TENANT_ID` and replace the password hash values with
fresh hashes generated above.

```sql
INSERT INTO users (id, email, hashed_password, role, tenant_id, created_at)
VALUES
  (
    gen_random_uuid(),
    'week6-reviewer@example.com',
    '<reviewer-password-hash>',
    'REVIEWER',
    '<tenant-id>',
    NOW()
  ),
  (
    gen_random_uuid(),
    'week6-manager@example.com',
    '<manager-password-hash>',
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
