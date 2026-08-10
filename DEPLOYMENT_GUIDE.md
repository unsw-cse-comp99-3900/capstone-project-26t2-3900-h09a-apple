# WorkTrace Production Deployment Guide

This deployment runs the FastAPI API, Celery friction worker, Next.js frontend,
PostgreSQL/pgvector, Redis, and automatic Alembic migrations with Docker Compose.

## Prerequisites

- Docker Engine 24+ or Docker Desktop
- Docker Compose v2 (`docker compose version`)
- 4 GB free memory (8 GB recommended when Whisper is preloaded)
- Ports 3000 and 8000 available, or custom values in `.env`

## Quick start

1. Create the production configuration:

   ```bash
   cp .env.example .env
   ```

2. Replace `SECRET_KEY` and `POSTGRES_PASSWORD` in `.env`. Generate a secret
   with `openssl rand -hex 32`.

3. Build and start the complete stack:

   ```bash
   docker compose up -d --build
   ```

The one-shot `migrate` service waits for PostgreSQL and runs `alembic upgrade
head` before the API and worker start. Redis and PostgreSQL are only reachable
on the internal Docker network. The default URLs are:

- Frontend: <http://localhost:3000>
- API health: <http://localhost:8000/health>

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
- `LLM_PROVIDER`, `SOP_GENERATOR`: default to deterministic `mock` mode.
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`: required only for the corresponding
  provider.
- `PRELOAD_WHISPER_MODEL`: defaults to `false` so startup health checks finish
  quickly. Set to `true` only when sufficient memory and startup time are
  available.
- `S3_*`: object storage configuration for production screenshots.

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
- Each friction task has a 170-second soft limit and 180-second hard limit,
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

### Health check is slow

Keep `PRELOAD_WHISPER_MODEL=false`. Inspect `docker compose logs api` for
database, model-download, or memory errors.

### Port conflict

Change `FRONTEND_PORT` or `API_PORT` in `.env`, then run `docker compose up -d`.
