# H09A Apple

UNSW COMP3900 26T2 capstone project.

Monorepo with a Next.js frontend (`apps/web`), a FastAPI backend (`apps/api`),
a Chrome MV3 extension (`apps/extension`), and shared TypeScript types in
`packages/types`.

## Git workflow

Feature work targets `develop`. Stable releases promote `develop` to `main`.
See [docs/git-workflow.md](docs/git-workflow.md).

## Engineering docs

Assessment-oriented index (architecture, testing, privacy, CI, troubleshooting):
[docs/teamwork-assessment-evidence.md](docs/teamwork-assessment-evidence.md).

## Requirements

- Node 20+
- pnpm 9+
- Python 3.11
- Docker (local PostgreSQL and MinIO for manual testing)

## Setup

```bash
pnpm install

cd apps/api
py -3.11 -m venv .venv          # Windows; macOS/Linux: python3.11 -m venv .venv
source .venv/Scripts/activate   # Windows Git Bash; macOS/Linux: source .venv/bin/activate
pip install -r requirements-dev.txt
cd ../..

cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
cp apps/api/.env.example apps/api/.env

./scripts/install-githooks.sh   # pre-commit CI checks + AI trailer block on commit
```

Python dependencies:

- `apps/api/requirements.txt` - runtime API dependencies (FastAPI, SQLAlchemy, psycopg 3, auth, LLM clients).
- `apps/api/requirements-dev.txt` - extends the above with `pytest`, `pytest-cov`, `httpx`, and `ruff` for local dev and CI.

## Database setup for manual testing

### PostgreSQL

Start the local container:

```bash
docker start worktrace-postgres
```

If the container does not exist yet:

```bash
docker run --name worktrace-postgres \
  -e POSTGRES_USER=worktrace \
  -e POSTGRES_PASSWORD=secret \
  -e POSTGRES_DB=worktrace \
  -p 5432:5432 \
  -d pgvector/pgvector:pg15
```

### MinIO (screenshot uploads)

Required when submitting sessions that include screenshots. Start or create:

```bash
docker start worktrace-minio
```

If the container does not exist yet (Git Bash on Windows: prefix with `MSYS_NO_PATHCONV=1`):

```bash
docker run --name worktrace-minio \
  -p 9000:9000 \
  -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  -d minio/minio server /data --console-address ":9001"
```

Create the bucket once (with MinIO running). Either use the console at
http://localhost:9001 (login `minioadmin` / `minioadmin`, create bucket
`worktrace-screenshots`), or:

```bash
docker run --rm minio/mc sh -c "\
  mc alias set local http://host.docker.internal:9000 minioadmin minioadmin && \
  mc mb --ignore-existing local/worktrace-screenshots"
```

On Linux, if `host.docker.internal` is unavailable, add
`--add-host=host.docker.internal:host-gateway` to the `docker run` command.

Ensure `apps/api/.env` matches `apps/api/.env.example` for `DATABASE_URL`, `S3_*`, `SECRET_KEY`, and `DEFAULT_TENANT_ID`.

### Run migrations

```bash
cd apps/api
source .venv/Scripts/activate   # Windows Git Bash; macOS/Linux: source .venv/bin/activate
alembic upgrade head
cd ../..
```

On Windows, replace `.venv/bin/` with `.venv/Scripts/` in paths above.

CI also verifies migrations with `alembic upgrade head`, `alembic downgrade base`, and `alembic upgrade head`.

## Run

`pnpm dev` runs the backend through `uvicorn`, which is only on `PATH` when the
Python venv is active in your shell. Activate it once per terminal session:

```bash
source apps/api/.venv/Scripts/activate   # macOS/Linux: source apps/api/.venv/bin/activate
```

Then:

```bash
pnpm dev          # frontend + backend
pnpm dev:web      # only frontend (http://localhost:3000)
pnpm dev:api      # only backend  (http://localhost:8000)
```

Build and load the extension before recording workflows:

```bash
pnpm --filter @h09a/extension build
```

Then load `apps/extension/dist` in `chrome://extensions` (see `apps/extension/README.md`).

Other scripts: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm format`.

## Testing

| Suite     | Framework | Scale                     | Coverage                                                     |
| --------- | --------- | ------------------------- | ------------------------------------------------------------ |
| API       | pytest    | 51 test files             | **91% statement** (`pytest --cov=app`)                       |
| Web       | Vitest    | 15 files / 69 tests       | **53% statement** (`pnpm --filter @h09a/web test:coverage`)  |
| Extension | node:test | **93 tests, all passing** | **65% line** (`pnpm --filter @h09a/extension test:coverage`) |

Web and extension figures are honest suite coverage, not claimed product-wide
coverage. Web is strongest on `lib/auth` and library helpers; consent UI and the
full `api.ts` client are thinner. Extension coverage is measured over modules
loaded by unit tests; popup chrome wiring and some launch/runtime paths sit
lower than the pure state helpers.

Strategy, layer breakdown and known gaps:
[`docs/testing/testing-strategy.md`](docs/testing/testing-strategy.md).

Requirements mapping:
[`docs/requirements-traceability.md`](docs/requirements-traceability.md).

### Code quality

| Practice                | State                                                                      |
| ----------------------- | -------------------------------------------------------------------------- |
| TypeScript              | `strict: true` workspace-wide; no `any` type annotations in `apps/web/src` |
| Python type annotations | 91% of functions annotate their return type; 97% of parameters             |
| Linting / formatting    | ruff (API), eslint (web), prettier; enforced in CI rather than advised     |
| Type checking           | `tsc --noEmit` across the workspace in CI                                  |
| Schema changes          | every migration proven reversible in CI (`alembic` up → down → up)         |

### Coverage by concern

API tests emphasise sad paths and mocked providers, not only happy paths
(counts from `apps/api/tests` status assertions / mock usage):

| Concern              | Covered by                                       | Evidence                                |
| -------------------- | ------------------------------------------------ | --------------------------------------- |
| Data validation      | Rejected payloads on write endpoints             | 20 assertions on HTTP 422               |
| Authentication       | Unauthenticated access to protected routes       | 23 assertions on HTTP 401               |
| Authorisation        | Wrong-role and cross-tenant access               | 9 assertions on HTTP 403                |
| Missing resources    | Unknown IDs and missing records                  | 12 assertions on HTTP 404               |
| Duplicate operations | Repeat registration / conflicting generate state | 3 assertions on HTTP 409                |
| External providers   | LLM and task helpers stubbed in unit tests       | 21 test files use `monkeypatch` / mocks |
| Server errors        | Downstream failure surfaced, not swallowed       | 2 assertions on HTTP 500                |

### Running the tests

```bash
cd apps/api && pytest --cov=app --cov-report=term
cd apps/web && pnpm test:coverage
cd apps/extension && pnpm test:coverage
```

### Tests requiring a live database

11 API tests need PostgreSQL with the pgvector extension and will fail against
a bare checkout:

- `tests/test_sop_step_embedding_schema.py` (4) - pgvector extension and
  ivfflat index assertions
- `tests/test_demo_smoke.py` (7) - end-to-end seeded-data checks

Run them with the stack up: `docker compose up -d`.

## Non-trivial implementations

**Two-stage visual element location** - `apps/api/app/vision_grid.py`,
`vision_locate_service.py`.
When a recorded CSS selector no longer matches the live page, the target is
located visually: a coarse grid pass narrows the region, then a cropped fine
pass returns viewport coordinates. Without this a walkthrough breaks the first
time the host page is rebuilt.

**Automatic cluster selection** - `apps/api/app/analytics_clustering.py`,
`workflow_clustering.py`.
Published SOP steps are embedded as 1536-dimensional vectors in pgvector.
K-means is run for candidate `k` values and the grouping with the highest
silhouette score (Rousseeuw, 1987) is kept, so the number of execution paths is
chosen by the data. Two different entry points enforce different minimum sample
sizes: `DEFAULT_MIN_SESSIONS = 5` in `analytics_clustering.py` and
`MIN_SESSIONS_FOR_CLUSTERING = 3` in `workflow_clustering.py`. Below those
floors the API raises an insufficient-data error rather than inventing a shape.

**Versioned friction model** - `apps/api/app/friction_*.py`.
Per-step friction = 0.60 x time + 0.25 x retries + 0.15 x path deviation,
clamped to 0-100. The time component is zero at half the expected duration and
saturates at twice it, so a single outlier cannot dominate a ranking. The model
version is stored with every score, so historical numbers remain explainable.

## Manual verification

Typical end-to-end flow after PostgreSQL (and MinIO, if using screenshots) are up:

1. Start both apps with `pnpm dev` (venv activated).
2. Record a workflow in the extension, then open review/submit from the web UI
   (`/session/review?id=...`).
3. Confirm navigation to `/session/{session_id}/generating`.
4. Confirm the generating page polls `GET /api/v1/sessions/{session_id}` and
   triggers `POST /api/v1/sessions/{session_id}/generate-sop` for a pending job.
5. Confirm redirect to `/sop/{sop_id}` after completion.
6. Confirm the SOP row exists in PostgreSQL (see below).

**Auth note:** Session and SOP API routes require `Authorization: Bearer <access_token>`.
Register or log in via `POST /api/v1/auth/register` and `POST /api/v1/auth/login`,
then pass the token on API calls. Web/extension Bearer integration may still be
in progress; use curl or an API client to verify the backend while UI auth is wired up.

Example:

```bash
curl -s http://localhost:8000/api/v1/auth/me \
  -H "Authorization: Bearer <access_token>"
```

## Database maintenance

### Check that a SOP was stored

```bash
docker exec -it worktrace-postgres psql -U worktrace -d worktrace
```

```sql
SELECT id, session_id, title, status, generated_at FROM sops;
```

If the expected workflow title appears, persistence is working.

### Empty application data

From inside `psql`:

```sql
TRUNCATE TABLE sops, codification_jobs, screenshots, events, sessions RESTART IDENTITY CASCADE;
```

Verify counts are zero:

```sql
SELECT count(*) FROM sops;
SELECT count(*) FROM sessions;
SELECT count(*) FROM codification_jobs;
SELECT count(*) FROM events;
```

To open `psql` from the shell:

```bash
docker exec -it worktrace-postgres psql -U worktrace -d worktrace
```

Quit `psql` with `\q`.

## Troubleshooting

| Symptom                                                            | Fix                                                                                                                                                             |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ArgumentError` / missing `DATABASE_URL` when running Alembic      | Create `apps/api/.env` from `apps/api/.env.example`. URL must use `postgresql+psycopg://worktrace:secret@localhost:5432/worktrace` (not `postgresql://` alone). |
| `ModuleNotFoundError: No module named 'psycopg2'`                  | Install dev deps: `pip install -r requirements-dev.txt` (uses **psycopg 3**, not `psycopg2-binary`).                                                            |
| `No module named 'anthropic'` (or similar) when running `pnpm dev` | Activate `apps/api/.venv` before `pnpm dev`.                                                                                                                    |
| API returns **401** on session submit                              | Attach a Bearer token from `/api/v1/auth/login` (see auth note above).                                                                                          |
| Port **3000** or **5432** already in use                           | Stop the conflicting process or container before starting dev services.                                                                                         |
| `commit-policy` CI fails on your PR                                | Forbid AI `Co-authored-by` trailers from commits; see [`docs/commit-policy.md`](docs/commit-policy.md).                                                         |

## Commit policy

PRs must not contain AI agent trailers (`Co-authored-by: Cursor`, Copilot, Codex,
etc.) in commit messages. CI runs the `commit-policy` check; install local hooks
with `./scripts/install-githooks.sh`. Before push, run `bash scripts/ci/pre-commit-check.sh`
to mirror CI locally. Details: [`docs/commit-policy.md`](docs/commit-policy.md).

## Branches

- `main` - only updated through PRs that pass CI. After H09AAPPLE-60, enable branch
  protection requiring **1 approval** and green checks: `web`, `api`, `extension`,
  `pr-title`, `visual-evidence`, and `commit-policy` (enable `visual-evidence` only
  after that workflow exists on `main`).
- `<TICKET-ID>-<kebab-case-card-title>` - one branch per Jira card,
  e.g. `H09AAPPLE-21-dev-ops-set-up-project-monorepo-and-ci-cd-pipeline`.
  Use the branch name Jira generates from the card title; do not shorten by hand.
  Created when work on a card starts, deleted after the PR is merged.

## Deployment

Frontend preview deploys are wired up via Vercel: every PR gets its own
preview URL, posted as a comment on the PR. See [`docs/deployment.md`](docs/deployment.md)
for one-time Vercel setup steps.
