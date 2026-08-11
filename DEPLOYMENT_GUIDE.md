# WorkTrace Production Deployment Guide

This deployment runs the FastAPI API, Celery friction worker, Next.js frontend,
PostgreSQL/pgvector, Redis, and automatic Alembic migrations with Docker Compose.

Assessors need **Docker** and **Chrome**. An IDE (VS Code, Cursor, or similar)
is not required.

**Which tree you have matters for the Chrome extension:**

| Source                                                         | `apps/extension/dist`                   | Need Node?                              |
| -------------------------------------------------------------- | --------------------------------------- | --------------------------------------- |
| Course **submission zip** from `scripts/package-submission.sh` | Included (appended after `git archive`) | No                                      |
| GitHub clone / "Download ZIP" / plain `git archive`            | **Absent** (`dist/` is gitignored)      | Yes: run the rebuild fallback in step 4 |

## Prerequisites

Install and leave running before any Compose commands:

| Required                                                                                            | Notes                                                                                                         |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Engine 24+) or Docker Engine 24+ | Wait until Docker shows **Running**. Confirm with `docker version` and `docker compose version` (Compose v2). |
| [Google Chrome](https://www.google.com/chrome/)                                                     | Load the unpacked MV3 extension and run the walkthrough.                                                      |
| 4 GB free memory (8 GB recommended if Whisper is preloaded)                                         |                                                                                                               |
| Free host ports **3000**, **8000**, **9000**, **9001**                                              | Or remap in `.env` (see Troubleshooting).                                                                     |

**Not required** for the submission-zip path: Node.js, pnpm, Python, or an IDE.
Use any shell that can run `docker`.

## Quick start (assessor path)

### 0. Unpack

Extract the archive and `cd` into the repository root (the folder that contains
`docker-compose.yml` and `.env.example`). Prefer the course **submission zip**.
If you only have a GitHub checkout, Compose still works, but you must build the
extension in step 4 before loading it in Chrome.

### 1. Configure environment

```bash
cp .env.example .env
```

Replace `SECRET_KEY` and `POSTGRES_PASSWORD`. Generate a secret with
`openssl rand -hex 32`.

The example already sets:

- `FRONTEND_PORT=3000` with matching `API_CORS_ORIGINS` and `WEB_BASE_URL`
- `NEXT_PUBLIC_EXTENSION_ID` for the fixed unpacked extension ID
- MinIO `S3_*` defaults (`minio` service + auto bucket create)

### 2. Build and start the stack

Compose starts PostgreSQL, Redis, MinIO (with bucket init), API, worker, and
frontend:

```bash
docker compose up -d --build
```

Default URLs:

- Frontend: <http://localhost:3000>
- API health: <http://localhost:8000/health>
- MinIO API: <http://localhost:9000>
- MinIO console (optional): <http://localhost:9001> (`minioadmin` / `minioadmin`)

Screenshots and voice uploads use the Compose MinIO service. Uploads use
`S3_ENDPOINT_URL=http://minio:9000` inside the network. Presigned GET URLs are
signed with `S3_PUBLIC_ENDPOINT_URL=http://localhost:9000` so the browser Host
matches SigV4 (do not rewrite a URL that was signed for `minio:9000`).

### 3. Seed REVIEWER and MANAGER accounts (required)

Self-service registration at `/register` **always** creates **EMPLOYEE**.
Without this seed step, assessors cannot open manager Analytics / friction
views or reviewer approve/publish flows.

`.env.example` sets `DEMO_ROLE_PASSWORD=11112222`. Copy that into `.env` before
`docker compose up` (Compose injects it into the API container). Recreate the
API container if you change the value later.

```bash
docker compose exec -T api python seeds/seed_demo_roles.py
```

| Email               | Password   | Role     |
| ------------------- | ---------- | -------- |
| `reviewer@work.com` | `11112222` | REVIEWER |
| `manager@work.com`  | `11112222` | MANAGER  |

Register any other email in the UI for an EMPLOYEE account.

### 4. Load the Chrome extension

Check that the prebuilt extension exists:

```bash
test -f apps/extension/dist/manifest.json && echo "dist present" || echo "dist missing"
```

**If `dist` is present** (submission zip): open `chrome://extensions`, enable
Developer mode, **Load unpacked**, and select `apps/extension/dist`. No Node.

**If `dist` is missing** (GitHub clone / source-only tree): `dist/` is not in
git. Build it once, then load the same folder:

```bash
corepack enable
corepack prepare pnpm@10.28.1 --activate
pnpm install
pnpm --filter @h09a/extension build
```

The fixed extension ID must be:

`bajibpeckacmfdmifdhccckiepadhgog`

That value is already set as `NEXT_PUBLIC_EXTENSION_ID` in `.env.example`.

### 5. Smoke path

1. Open <http://localhost:3000> and register an EMPLOYEE (or use the seeded
   accounts above).
2. Sign in to the extension popup with the same account.
3. Record a short workflow, submit, and generate an SOP.
4. Sign in as `reviewer@work.com` → approve → publish.
5. As EMPLOYEE, open Library → **Start walkthrough** and confirm the on-page
   overlay appears (step chrome, next/back, highlight ring).

   **Mock / no API key (default `.env.example`):** step titles, instruction
   text, and highlight targets are **illustrative only**. They often do not
   match the live page (wrong copy, vague "Click [icon]", or a highlight on
   the wrong control). That is expected without `OPENAI_API_KEY` /
   `ANTHROPIC_API_KEY`. Judge the smoke on overlay **mechanics**, not copy
   accuracy. For accurate guidance and selectors, use **Full verification**
   under LLM modes below, then record and generate again.

6. Sign in as `manager@work.com` for Analytics / friction views.

## LLM modes (mock vs real keys)

The brief allows secrets in the zipped submission as long as they are **not**
committed to GitHub.

| Mode              | `.env` settings                                                      | What you get                                                                                |
| ----------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Default (no cost) | `LLM_PROVIDER=mock` (API keys empty; `.env.example` default)         | Stack runs; SOP / walkthrough text and highlights are stubs, **not** page-accurate          |
| Full verification | `LLM_PROVIDER=openai` or `anthropic` **and** a real matching API key | Real step wording and tighter target binding; recreate `api` after changing keys / provider |

Generator selection follows `LLM_PROVIDER` (`mock` → `MockSopGenerator`;
`openai` / `anthropic` → LLM path). After switching to real keys:

```bash
# In .env, for example:
# LLM_PROVIDER=openai
# OPENAI_API_KEY=sk-...
docker compose up -d --force-recreate api worker
```

Then record a **new** session and generate a new SOP; old mock SOPs stay mock.

For a zip submission, place keys in a root file `SECRETS.txt` that is **not**
tracked by git, and copy values into `.env` before `docker compose up`. Never
commit `SECRETS.txt` or `.env`.

## Configuration

The root `.env.example` lists all supported Compose values.

- `FRONTEND_PORT`, `API_PORT`: host ports (defaults: 3000 and 8000). Keep
  `FRONTEND_PORT` aligned with the extension `externally_connectable` hosts
  (`localhost:3000` / `127.0.0.1:3000`) unless you also update the extension
  manifest.
- `POSTGRES_PORT`, `REDIS_PORT`, `MINIO_API_PORT`, `MINIO_CONSOLE_PORT`: host
  publish ports only (defaults 5432, 6379, 9000, 9001). Containers still talk
  to each other on the Compose network; you normally do **not** change
  `DATABASE_URL` when remapping `POSTGRES_PORT`.
- `NEXT_PUBLIC_API_BASE_URL`: API URL reachable by users' browsers. For a
  remote deployment, use the public API hostname, not `localhost`.
- `NEXT_PUBLIC_EXTENSION_ID`: Chrome extension ID for web-to-extension
  messaging. Build-time only; change requires
  `docker compose up -d --build frontend`.
- `API_CORS_ORIGINS`: comma-separated allowed frontend origins (default
  `http://localhost:3000`).
- `WEB_BASE_URL`: public frontend URL used by backend links and auth (default
  `http://localhost:3000`).
- `SECRET_KEY`: JWT signing key; always replace the example value.
- `POSTGRES_*`: database name and credentials.
- `LLM_PROVIDER`, `SOP_GENERATOR`: see **LLM modes** below.
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`: required only for the corresponding
  provider.
- `PRELOAD_WHISPER_MODEL`: defaults to `false` so startup health checks finish
  quickly. Set to `true` only when sufficient memory and startup time are
  available.
- `S3_*`: object storage for screenshots and voice. Compose defaults upload via
  the `minio` service (`http://minio:9000`) and sign browser GET URLs with
  `S3_PUBLIC_ENDPOINT_URL` (`http://localhost:9000`) so SigV4 Host matches.

Because the web app contains Next.js server routes for authentication, its
production image uses Next.js standalone output. It cannot be reduced to
static `dist/` files served by nginx without removing those server-side routes.

## Verify health

```bash
docker compose ps
curl --fail http://localhost:8000/health
curl --fail http://localhost:3000/
docker compose exec redis redis-cli ping
docker compose exec postgres pg_isready -U worktrace -d worktrace
docker compose exec worker celery -A app.task_queue.celery_app inspect ping
```

All long-running services should report `healthy`. The API health endpoint is
designed to respond within five seconds and does not preload Whisper by default.

## Object storage notes

MinIO runs inside Compose (`minio` + `minio-init`). After changing `S3_*` in
`.env`, recreate API and worker so they pick up the values:

```bash
docker compose up -d --force-recreate api worker
```

If signed screenshot URLs fail in the browser, confirm
`S3_PUBLIC_ENDPOINT_URL` is reachable from the host (default
`http://localhost:9000`) and that `MINIO_API_PORT` is free.

## Demo roles (reference)

See also `docs/week6-demo-users.md`. Prefer
`docker compose exec -T api python seeds/seed_demo_roles.py` so assessors do
not need a host Python venv.

## Friction pipeline

Publishing an approved SOP creates a `pending` row in `friction_analysis` and
emits the Celery task `friction_calculation.triggered`. The worker:

1. Selects the latest completion for each employee who executed the SOP.
2. Scores every employee-step pair from duration, retries, and recorded path
   deviations on a bounded 0-100 scale.
3. Stores employee-step scores and per-step average/min/max benchmarks.
4. Marks high IQR outliers and identifies the best/worst employee per step.
5. Publishes `friction_analysis.updated` through Redis for the dashboard
   WebSocket.

Managers and reviewers can query the latest result at
`GET /api/v1/analytics/friction/{sop_id}`. Authenticated WebSocket clients can
subscribe at `/api/v1/analytics/friction/ws`; the access token is read from the
`wt_access_token` cookie or the `token` query parameter.

## Logs and operations

```bash
docker compose logs -f
docker compose logs -f api worker
docker compose restart worker
docker compose up -d --build api worker frontend
docker compose down
```

`docker compose down` preserves named volumes. Do not use `docker compose down
-v` in production because it deletes PostgreSQL and Redis data.

## Backup and restore

Create a compressed PostgreSQL backup:

```bash
docker compose exec -T postgres \
  pg_dump -U worktrace -d worktrace -Fc > worktrace-$(date +%Y%m%d-%H%M%S).dump
```

Restore into an empty database (stop API/worker writes first):

```bash
docker compose stop api worker
docker compose exec -T postgres dropdb -U worktrace --if-exists worktrace
docker compose exec -T postgres createdb -U worktrace worktrace
docker compose exec -T postgres \
  pg_restore -U worktrace -d worktrace --clean --if-exists < backup.dump
docker compose up -d api worker
```

Redis contains queue and transient notification state; PostgreSQL is the source
of truth for friction results. Back up the `postgres_data` volume regularly.

## Persistence verification

```bash
docker compose exec -T postgres \
  psql -U worktrace -d worktrace -c "SELECT count(*) FROM alembic_version;"
docker compose stop postgres
docker compose rm -f postgres
docker compose up -d postgres
docker compose exec -T postgres \
  psql -U worktrace -d worktrace -c "SELECT count(*) FROM alembic_version;"
```

The count must remain unchanged after the PostgreSQL container is recreated.

## Performance tuning

- Add workers for concurrent SOP calculations:

  ```bash
  docker compose up -d --scale worker=3
  ```

- The worker prefetch multiplier is one, so large jobs do not starve other
  workers.
- Each friction task has a 170-second soft limit and a 180-second hard limit,
  matching the accepted 2-3 minute processing window.
- Increase PostgreSQL memory and connection limits based on the host, and
  monitor query latency on the friction analysis indexes.
- Keep `PRELOAD_WHISPER_MODEL=false` when friction/API capacity is more
  important than first-transcription latency.

## Troubleshooting

### Migration service exits non-zero

```bash
docker compose logs migrate postgres
docker compose run --rm migrate alembic current
docker compose run --rm migrate alembic upgrade head
```

Check database credentials and free disk space before retrying.

### Friction analysis remains pending

```bash
docker compose ps worker redis
docker compose logs worker redis
docker compose exec redis redis-cli LLEN celery
docker compose exec worker celery -A app.task_queue.celery_app inspect active
```

Confirm both services use `redis://redis:6379/0`. A failed analysis stores a
bounded error message in `friction_analysis.error_message`.

### Frontend cannot reach the API

Set `NEXT_PUBLIC_API_BASE_URL` to a URL reachable from the browser, then rebuild
the frontend because public Next.js variables are embedded at build time:

```bash
docker compose up -d --build frontend
```

Also include the frontend origin in `API_CORS_ORIGINS`.

### Screenshots or voice upload fail

Confirm `docker compose ps` shows `minio` healthy and `minio-init` exited 0,
`S3_*` matches `.env.example`, and `api` / `worker` were recreated after any
`S3_*` change. Presigned URLs must be signed with `S3_PUBLIC_ENDPOINT_URL` (not rewritten
from the internal hostname), or the browser will get SignatureDoesNotMatch.

### Extension cannot start walkthrough

Confirm the loaded unpacked ID is `bajibpeckacmfdmifdhccckiepadhgog`, the
frontend was built with that `NEXT_PUBLIC_EXTENSION_ID`, and the site is opened
on `http://localhost:3000` (not port 80).

### Health check is slow

Keep `PRELOAD_WHISPER_MODEL=false`. Inspect `docker compose logs api` for
database, model-download, or memory errors.

### Port conflict (`bind: address already in use`)

Compose publishes Postgres, Redis, MinIO, API, and the frontend to the host.
A local PostgreSQL install (or another container such as `luma_postgres`) often
already owns **5432**, which stops `postgres` from starting and leaves `api` /
`migrate` in `Created`.

Prefer remapping the host port in `.env` (leave any system Postgres running):

```bash
# Example: host 5433 -> container 5432. In-compose DATABASE_URL stays unchanged.
echo 'POSTGRES_PORT=5433' >> .env
docker compose up -d
```

Other host mappings if needed: `REDIS_PORT`, `MINIO_API_PORT`,
`MINIO_CONSOLE_PORT`, `FRONTEND_PORT`, `API_PORT`. After editing `.env`, run
`docker compose up -d` again (rebuild is not required for port-only changes).

Alternatively stop the process holding the port, then retry
`docker compose up -d`. On macOS, `lsof -nP -iTCP:5432 -sTCP:LISTEN` shows the
listener.

## Packaging a submission zip

Maintainers (not assessors) build the zip markers receive. GitHub alone is not
enough for the no-Node extension path because `apps/extension/dist` is
gitignored.

```bash
pnpm --filter @h09a/extension build   # must exist before packaging
bash scripts/package-submission.sh
```

The script runs `git archive` for `HEAD`, **then appends**
`apps/extension/dist`, and optionally appends an untracked `SECRETS.txt` if
present. Extract that zip elsewhere and follow **Quick start** without `pnpm`.
