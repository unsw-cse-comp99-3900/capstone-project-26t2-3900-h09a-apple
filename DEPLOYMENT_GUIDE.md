# WorkTrace Production Deployment Guide

This deployment runs the FastAPI API, Celery friction worker, Next.js frontend,
PostgreSQL/pgvector, Redis, and automatic Alembic migrations with Docker Compose.

Assessors need **Docker** and **Chrome**. Node, pnpm, and a local Python venv are
not required for the default path when the submission zip includes
`apps/extension/dist`.

## Prerequisites

- Docker Engine 24+ or Docker Desktop
- Docker Compose v2 (`docker compose version`)
- 4 GB free memory (8 GB recommended when Whisper is preloaded)
- Ports **3000**, **8000**, **9000**, and **9001** available (or override in
  `.env` / MinIO flags)

## Quick start (assessor path)

### 1. Configure environment

```bash
cp .env.example .env
```

Replace `SECRET_KEY` and `POSTGRES_PASSWORD`. Generate a secret with
`openssl rand -hex 32`.

The example already sets:

- `FRONTEND_PORT=3000` with matching `API_CORS_ORIGINS` and `WEB_BASE_URL`
- `NEXT_PUBLIC_EXTENSION_ID` for the fixed unpacked extension ID
- local MinIO `S3_*` defaults for screenshots and voice uploads

### 2. Start object storage (MinIO)

Screenshots and voice feedback require S3-compatible storage. Compose does not
bundle MinIO; start it once on the host:

```bash
docker start worktrace-minio 2>/dev/null || docker run -d --name worktrace-minio \
  -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  minio/minio server /data --console-address ":9001"
```

Create the bucket once (Git Bash on Windows: prefix with `MSYS_NO_PATHCONV=1`):

```bash
docker run --rm --entrypoint /bin/sh minio/mc -c \
  "mc alias set local http://host.docker.internal:9000 minioadmin minioadmin && \
   mc mb --ignore-existing local/worktrace-screenshots"
```

Console (optional): <http://localhost:9001> (`minioadmin` / `minioadmin`).

### 3. Build and start the stack

```bash
docker compose up -d --build
```

Default URLs:

- Frontend: <http://localhost:3000>
- API health: <http://localhost:8000/health>

### 4. Seed REVIEWER and MANAGER accounts

Self-service registration at `/register` always creates **EMPLOYEE**. Create
demo elevated roles after the API is healthy:

```bash
docker compose exec -T api python seeds/seed_demo_roles.py
```

| Email               | Password   | Role     |
| ------------------- | ---------- | -------- |
| `reviewer@work.com` | `11112222` | REVIEWER |
| `manager@work.com`  | `11112222` | MANAGER  |

Register any other email in the UI for an EMPLOYEE account.

### 5. Load the Chrome extension

**Primary path (no Node required):** open `chrome://extensions`, enable
Developer mode, then **Load unpacked** and select `apps/extension/dist` from
the extracted submission (or this repo after a maintainer has built it).

The fixed extension ID must be:

`bajibpeckacmfdmifdhccckiepadhgog`

That value is already set as `NEXT_PUBLIC_EXTENSION_ID` in `.env.example`.

**Fallback (rebuild from source):** requires Node 20+ and pnpm:

```bash
corepack enable
corepack prepare pnpm@10.28.1 --activate
pnpm install
pnpm --filter @h09a/extension build
```

Then load `apps/extension/dist` as above.

### 6. Smoke path

1. Open <http://localhost:3000> and register an EMPLOYEE (or use the seeded
   accounts above).
2. Sign in to the extension popup with the same account.
3. Record a short workflow, submit, and generate an SOP.
4. Sign in as `reviewer@work.com` → approve → publish.
5. As EMPLOYEE, open Library → **Start walkthrough** and confirm the on-page
   overlay.
6. Sign in as `manager@work.com` for Analytics / friction views.

## LLM modes (mock vs real keys)

The brief allows secrets in the zipped submission as long as they are **not**
committed to GitHub.

| Mode              | `.env` settings                                                     | When to use                                                |
| ----------------- | ------------------------------------------------------------------- | ---------------------------------------------------------- |
| Default (no cost) | `SOP_GENERATOR=mock`, `LLM_PROVIDER=mock`                           | Assessor smoke path; deterministic SOP text and embeddings |
| Full verification | Set `LLM_PROVIDER=openai` (or `anthropic`) and the matching API key | Real generation / embeddings                               |

For full verification in a zip submission, place keys in a root file
`SECRETS.txt` that is **not** tracked by git, and copy values into `.env`
before `docker compose up`. Never commit `SECRETS.txt` or `.env`.

## Configuration

The root `.env.example` lists all supported Compose values.

- `FRONTEND_PORT`, `API_PORT`: host ports (defaults: 3000 and 8000). Keep
  `FRONTEND_PORT` aligned with the extension `externally_connectable` hosts
  (`localhost:3000` / `127.0.0.1:3000`) unless you also update the extension
  manifest.
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
- `S3_*`: object storage for screenshots and voice. Local defaults point at
  MinIO on `host.docker.internal:9000`.

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

After changing `S3_*` in `.env`, recreate API and worker so they pick up the
values:

```bash
docker compose up -d --force-recreate api worker
```

On Linux, if `host.docker.internal` is unavailable, add
`--add-host=host.docker.internal:host-gateway` to the MinIO `docker run`, or
set `S3_ENDPOINT_URL` to a reachable host IP from the containers.

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

Confirm MinIO is running, the `worktrace-screenshots` bucket exists, and
`S3_*` in `.env` matches the MinIO credentials. Recreate `api` and `worker`
after changing those values.

### Extension cannot start walkthrough

Confirm the loaded unpacked ID is `bajibpeckacmfdmifdhccckiepadhgog`, the
frontend was built with that `NEXT_PUBLIC_EXTENSION_ID`, and the site is opened
on `http://localhost:3000` (not port 80).

### Health check is slow

Keep `PRELOAD_WHISPER_MODEL=false`. Inspect `docker compose logs api` for
database, model-download, or memory errors.

### Port conflict

Change `FRONTEND_PORT` or `API_PORT` in `.env`, then run `docker compose up -d`.

## Packaging a submission zip

Maintainers (not assessors) can build a zip that includes a prebuilt extension
so markers do not need Node:

```bash
bash scripts/package-submission.sh
```

This runs `git archive` for `HEAD`, appends `apps/extension/dist`, and optionally
appends an untracked `SECRETS.txt` if present. Extract elsewhere and follow this
guide from **Quick start** without `pnpm`.
