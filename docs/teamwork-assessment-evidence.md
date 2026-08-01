# Engineering practices evidence index

Link map for Week 9 / engineering-practices assessment. Content lives in the
linked files; this page is navigation only.

## CI/CD

- Workflow: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)
- Policy workflows: `pr-title.yml`, `content-policy.yml`, `commit-policy.yml`
- CI/CD notes: [docs/development/ci-cd.md](./development/ci-cd.md)
- Branching: [docs/git-workflow.md](./git-workflow.md)
- Inspect GitHub **Actions** for green runs on PRs targeting `develop` or `main`
- Branch protection required checks include: `web`, `api`, `content-policy`,
  `pr-title`, `commit-policy`

## Automated testing

- Strategy: [docs/testing/testing-strategy.md](./testing/testing-strategy.md)
- API tests: `apps/api/tests/`
- Web tests: `apps/web/src/**/*.test.ts(x)` (`apps/web/vitest.config.ts`)
- Extension tests: `apps/extension/src/**/*.test.js`
- Desktop storage tests: `packages/desktop-storage/test/`
- Electron manual / spike evidence:
  [docs/spikes/electron-desktop-capture-review.md](./spikes/electron-desktop-capture-review.md)

## API documentation

- Overview: [docs/api/api-overview.md](./api/api-overview.md)
- Live OpenAPI while API is running:
  - Swagger UI: `http://localhost:8000/docs`
  - ReDoc: `http://localhost:8000/redoc`
  - OpenAPI JSON: `http://localhost:8000/openapi.json`
- App entry: `apps/api/app/main.py`

## Deployment

- `docker-compose.yml` (Postgres, Redis)
- Env templates: `.env.example`, `apps/api/.env.example`, `apps/web/.env.example`
- Guide: [docs/deployment.md](./deployment.md)
- Local setup also in root [README.md](../README.md)
- API image: `apps/api/Dockerfile`
- Web production deploy job: `deploy-web` in `ci.yml` (push to `main`)

## Logging and troubleshooting

- Health: `GET /health` and `GET /api/v1/health` in `apps/api/app/main.py`
- Ops notes: [docs/troubleshooting.md](./troubleshooting.md)

## Security and privacy

- Design: [docs/security/privacy-design.md](./security/privacy-design.md)
- PII: `apps/api/app/pii.py` (+ `apps/api/tests/test_pii.py`)
- Auth / RBAC / tenant: `apps/api/app/auth/`
- Consent: `apps/api/app/consent_routes.py`

## Living documentation

- Architecture: [docs/architecture/system-overview.md](./architecture/system-overview.md)
- Deployment diagram: [docs/architecture/aws-deployment.png](./architecture/aws-deployment.png)
- DB schema: [docs/db-schema.md](./db-schema.md)
- Git workflow: [docs/git-workflow.md](./git-workflow.md)
- README: [README.md](../README.md)

## Traceability reminder

Prefer chains of the form:

Jira key -> feature branch -> PR into `develop` -> CI checks -> docs/code links
-> observable behaviour (local or deployed).
