# WorkTrace Installation and Deployment Guide

**Course markers / tutors:** this file (and the matching PDF in the Moodle
submission) is the **only** install manual you need. The repository
`README.md` opens with **Start here (markers / clean machine)** and links here.
Ignore the README developer `pnpm` Setup section unless you are changing code.

This guide runs the FastAPI API, Celery friction worker, Next.js frontend,
PostgreSQL/pgvector, Redis, MinIO, and automatic Alembic migrations with Docker
Compose.

## Marker checklist (read before typing)

Do these in order. Most "broken install" reports are one of the skips below.

1.  **Use the Moodle submission zip**, not a GitHub "Download ZIP" / bare clone,
    if you want the no-Node path. GitHub trees omit `apps/extension/dist`
    (`dist/` is gitignored). The submission zip appends a prebuilt `dist`.
2.  **Install only Docker Desktop + Google Chrome.** You do **not** need VS Code,
    Cursor, Node, pnpm, or Python for the submission-zip path.
3.  **Start Docker Desktop and wait until it says Running** before any
    `docker compose` command (`docker version` and `docker compose version` must
    work).
4.  **Unpack, then `cd` into the folder that contains both** `docker-compose.yml`
    **and** `.env.example` (often named like `...-main` after unzip).
5.  **Copy env once:** `cp .env.example .env`. Change `SECRET_KEY` and
    `POSTGRES_PASSWORD`. Leave `DEMO_ROLE_PASSWORD=11112222` unless you know you
    need another password (seeded accounts use this value).
6.  **Do not start a separate MinIO or Postgres with `docker run`.** Compose
    already starts `postgres`, `redis`, `minio`, and `minio-init` (bucket create).
    A hand-started `worktrace-minio` on port 9000 will conflict.
7.  **Do not add `docker compose -p worktrace` unless every command uses the same
    `-p`.** This guide uses the default project name (directory name). Mixing
    `-p` and no `-p` makes `exec` hit the wrong stack.
8.  **If `up` fails with `address already in use` on 5432**, your machine already
    has PostgreSQL (common on macOS). Add `POSTGRES_PORT=5433` to `.env` and run
    `docker compose up -d` again. You do **not** change in-compose DB URLs.
    Same idea for 6379 / 9000 / 3000 / 8000 via `REDIS_PORT`, `MINIO_*_PORT`,
    `FRONTEND_PORT`, `API_PORT`.
9.  **First `docker compose up -d --build` can take several minutes.** Wait until
    `docker compose ps` shows `api` / `frontend` / `postgres` / `redis` /
    `minio` healthy (or running), and `migrate` / `minio-init` exited 0.
10. **You must run the seed** after the API is up. UI `/register` only creates
    **EMPLOYEE**. Without seed you cannot demo REVIEWER approve/publish or
    MANAGER analytics:

        docker compose exec -T api python seeds/seed_demo_roles.py

    | Email               | Password   | Role     |
    | ------------------- | ---------- | -------- |
    | `reviewer@work.com` | `11112222` | REVIEWER |
    | `manager@work.com`  | `11112222` | MANAGER  |

11. **Load the unpacked extension from `apps/extension/dist`.** Confirm
    `apps/extension/dist/manifest.json` exists. Chrome ID must be
    `bajibpeckacmfdmifdhccckiepadhgog`. Open the site at
    **http://localhost:3000** (not port 80, not a random host).
12. **Default mock LLM (no API key) is intentional.** SOP step text and
    highlight rings are often **wrong relative to the live page**. Pass the
    smoke if the overlay UI works (steps, next/back, a highlight appears). For
    page-accurate copy, set real keys (see **LLM modes**) and generate a **new**
    SOP.
13. **Extension login:** use the same account in the web app and the extension
    popup (web handoff / sign-in). Record on a normal https page (e.g.
    example.com) for the simplest walkthrough.
14. **Success looks like:** health curls OK; seed printed updated roles; Chrome
    shows the fixed extension ID; EMPLOYEE can record and submit; REVIEWER can
    approve/publish; EMPLOYEE can Start walkthrough and see overlay chrome;
    MANAGER can open Analytics / friction (may be empty until enough data).

**Which tree you have (extension `dist`):**

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
| Free host ports **3000**, **8000**, **9000**, **9001** (and usually **5432**, **6379**)             | Or remap in `.env` (see Troubleshooting). Local Postgres often blocks 5432.                                   |

**Not required** for the submission-zip path: Node.js, pnpm, Python, or an IDE.
Use any shell that can run `docker` (macOS Terminal, Windows PowerShell, or Git
Bash). Commands below assume you are in the repository root.

## Quick start (assessor path)

### 0. Unpack

Extract the Moodle submission zip (preferred) and `cd` into the repository root
(the directory that contains `docker-compose.yml` and `.env.example`).

```bash
pwd   # should show .../something that contains docker-compose.yml
ls docker-compose.yml .env.example DEPLOYMENT_GUIDE.md
```

If you only have a GitHub checkout, Compose still works, but you must build the
extension in step 4 before loading it in Chrome.

### 1. Configure environment

```bash
cp .env.example .env
```

Replace `SECRET_KEY` and `POSTGRES_PASSWORD`. Generate a secret with
`openssl rand -hex 32` (or any long random string).

Keep these defaults unless you have a port conflict:

- `DEMO_ROLE_PASSWORD=11112222` (seeded reviewer/manager password)
- `FRONTEND_PORT=3000` with matching `API_CORS_ORIGINS` and `WEB_BASE_URL`
- `NEXT_PUBLIC_EXTENSION_ID=bajibpeckacmfdmifdhccckiepadhgog`
- MinIO `S3_*` pointing at the Compose `minio` service + public localhost URL

If you already know host port **5432** is taken:

```bash
echo 'POSTGRES_PORT=5433' >> .env
```

### 2. Build and start the stack

Compose starts PostgreSQL, Redis, MinIO (with bucket init), migrate, API,
worker, and frontend. **Do not** run a separate MinIO container.

```bash
docker compose up -d --build
```

First build commonly takes 5-15 minutes depending on network. Then:

```bash
docker compose ps
curl --fail http://localhost:8000/health
curl --fail -o /dev/null -w "%{http_code}\n" http://localhost:3000/
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

If Postgres stays `Created` and logs say port 5432 is busy, see **Port
conflict** under Troubleshooting, then `docker compose up -d` again.

### 3. Seed REVIEWER and MANAGER accounts (required)

Self-service registration at `/register` **always** creates **EMPLOYEE**.
Without this seed step, assessors cannot open manager Analytics / friction
views or reviewer approve/publish flows.

`.env.example` sets `DEMO_ROLE_PASSWORD=11112222`. That value must be in `.env`
**before** `docker compose up` (Compose injects it into the API container). If
you change it later:

```bash
docker compose up -d --force-recreate api
docker compose exec -T api python seeds/seed_demo_roles.py
```

```bash
docker compose exec -T api python seeds/seed_demo_roles.py
```

| Email               | Password   | Role     |
| ------------------- | ---------- | -------- |
| `reviewer@work.com` | `11112222` | REVIEWER |
| `manager@work.com`  | `11112222` | MANAGER  |

Register any other email in the UI for an EMPLOYEE account (or use one of the
seeded accounts and switch roles only via seed).

### 4. Load the Chrome extension

Check that the prebuilt extension exists:

```bash
test -f apps/extension/dist/manifest.json && echo "dist present" || echo "dist missing"
```

**If `dist` is present** (submission zip): open `chrome://extensions`, enable
Developer mode, **Load unpacked**, and select the `apps/extension/dist` folder
(not `apps/extension` source). No Node.

**If `dist` is missing** (GitHub clone / source-only tree): `dist/` is not in
git. Build it once, then load the same folder:

```bash
corepack enable
corepack prepare pnpm@10.28.1 --activate
pnpm install
pnpm --filter @h09a/extension build
```

The fixed extension ID on `chrome://extensions` must be exactly:

`bajibpeckacmfdmifdhccckiepadhgog`

That value is already set as `NEXT_PUBLIC_EXTENSION_ID` in `.env.example` and
baked into the frontend image. If the ID differs, you loaded the wrong folder
or an old build.

Pin the extension and keep it enabled while testing walkthrough.

### 5. Smoke path

1. Open <http://localhost:3000> (must match `FRONTEND_PORT` / CORS).
2. Register a new EMPLOYEE **or** sign in as a seeded account.
3. Open the extension popup and sign in with the **same** account (use the web
   handoff / sign-in control if shown).
4. Record a short workflow on a simple page (e.g. https://example.com), stop,
   submit, and wait for SOP generation.
5. Sign out, sign in as `reviewer@work.com` / `11112222` → open Review →
   **Approve** → **Publish**.
6. Sign in as the EMPLOYEE again → Library → open the published SOP →
   **Start walkthrough**. Confirm the on-page overlay appears (step panel,
   next/back, highlight ring).

   **Mock / no API key (default):** step titles, instruction text, and highlight
   targets are **illustrative only**. Wrong copy, "Click [icon]", or a ring on
   the wrong control is **expected**. Judge overlay **mechanics**, not NLP
   accuracy. For accurate guidance, use **LLM modes** (real key), recreate
   `api`, then record and generate a **new** SOP.

7. Sign in as `manager@work.com` / `11112222` for Analytics / friction views
   (charts may show empty / insufficient-data states until enough sessions
   exist; that is normal).

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
- `LLM_PROVIDER`: see **LLM modes** above (`mock` / `openai` / `anthropic`).
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

### Common mistakes (quick map)

| Symptom                                               | Likely cause                                              | Fix                                                               |
| ----------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------- |
| No `apps/extension/dist`                              | Used GitHub zip/clone                                     | Build per step 4, or use Moodle submission zip                    |
| `bind: address already in use` on 5432                | Host PostgreSQL                                           | `POSTGRES_PORT=5433` in `.env`, then `docker compose up -d`       |
| `api` stuck in `Created`                              | Postgres never became healthy (often port clash)          | Fix ports; `docker compose ps` / `logs postgres`                  |
| Cannot open Review / Analytics as expected            | Skipped seed; only EMPLOYEE from `/register`              | Run step 3 seed                                                   |
| Seed password rejected                                | Changed `DEMO_ROLE_PASSWORD` after `up` without recreate  | Recreate `api`, re-run seed                                       |
| Walkthrough "extension missing" / wrong ID            | Loaded `apps/extension` instead of `dist`, or stale build | Load `apps/extension/dist`; ID must match                         |
| Site on wrong port / CORS errors                      | Not using `http://localhost:3000`                         | Match `FRONTEND_PORT` and rebuild frontend if you changed it      |
| Screenshots 403 / SignatureDoesNotMatch               | Public S3 URL / Host mismatch                             | Keep dual endpoints per Object storage notes; recreate api/worker |
| SOP text / highlights look nonsense                   | `LLM_PROVIDER=mock`, empty API keys                       | Expected; see Marker checklist item 12 and **LLM modes**          |
| Ran `docker run ... minio` then Compose fails on 9000 | Duplicate MinIO                                           | Stop/remove the hand-started container; use Compose only          |
| `docker compose exec` cannot find service             | Mixed `-p` project names                                  | Always omit `-p`, or always use the same `-p`                     |

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
bash scripts/package-submission.sh
```

The script **builds** `apps/extension/dist` itself (`pnpm --filter @h09a/extension
build`), then `git archive`s `HEAD`, **then appends** that `dist` into the zip
(and optionally an untracked `SECRETS.txt`). Maintainers need Node only to run
this script; markers who extract the resulting zip do not. Extract that zip
elsewhere and follow **Quick start** without `pnpm`.
