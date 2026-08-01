# API overview

Short guide to running and discovering the FastAPI service. Endpoint details
come from OpenAPI at runtime; this page does not duplicate the full schema.

## Start the API

Prerequisites: Python 3.11 venv with `apps/api/requirements-dev.txt`, Postgres
reachable, env file from `apps/api/.env.example`.

```bash
# from repo root, with venv activated
pnpm dev:api
# or: cd apps/api && uvicorn app.main:app --reload --port 8000
```

Default base URL: `http://localhost:8000`

Full stack: activate venv, then `pnpm dev` (web + API). See root README.

## Interactive docs

| Surface      | URL                                  |
| ------------ | ------------------------------------ |
| Swagger UI   | `http://localhost:8000/docs`         |
| ReDoc        | `http://localhost:8000/redoc`        |
| OpenAPI JSON | `http://localhost:8000/openapi.json` |

App factory: `apps/api/app/main.py` (`FastAPI(title="H09A Apple API", ...)`).

## Version prefix and health

Most product routes use the `/api/v1` prefix (auth, sessions, consent, feedback,
walkthrough, workflows, analytics, and related routers).

Manager variance dashboard helpers (H09AAPPLE-38):

- `GET /api/v1/analytics/friction` - PII-free ranked workflow friction summaries (MANAGER)
- `GET /api/v1/workflows/{sop_id}/insight-summary` - executive insight + one-line teaser (MANAGER)
- Friction WS ticket / stream are MANAGER-only to match the variance UI
- `POST /api/v1/walkthroughs/complete` still allows EMPLOYEE+ and enqueues async friction
  recalculation when the SOP is already `published`

Health (no auth):

- `GET /health`
- `GET /api/v1/health`

Both return `{"status":"ok"}`.

## Authentication overview

- Register / login under `/api/v1/auth/...` (see Swagger tags)
- Protected routes expect `Authorization: Bearer <access_token>`
- Role gates via `require_role`; tenant scoping via `filter_by_tenant`
  (`apps/api/app/auth/deps.py`)

Privacy-related behaviour: [docs/security/privacy-design.md](../security/privacy-design.md).

## Related

- [docs/architecture/system-overview.md](../architecture/system-overview.md)
- [docs/troubleshooting.md](../troubleshooting.md)
- [docs/db-schema.md](../db-schema.md)
