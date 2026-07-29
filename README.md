# H09A Apple

UNSW COMP3900 26T2 capstone project.

Monorepo with a Next.js frontend (`apps/web`), a FastAPI backend (`apps/api`),
a Chrome MV3 extension (`apps/extension`), and shared TypeScript types in
`packages/types`.

## Git workflow

Feature work targets `develop`. Stable releases promote `develop` to `main`.
See [docs/git-workflow.md](docs/git-workflow.md).

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
