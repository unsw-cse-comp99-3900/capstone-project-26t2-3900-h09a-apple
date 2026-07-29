# Troubleshooting

Practical failures the team has hit (or hits often in local setup). This is not
a full observability platform description.

## Quick health checks

With the API running:

```bash
curl -s http://localhost:8000/health
curl -s http://localhost:8000/api/v1/health
```

Expect `{"status":"ok"}`.

Web UI: open `http://localhost:3000` after `pnpm dev:web` or `pnpm dev`.

## PostgreSQL cannot connect

Symptoms: API startup or `alembic` fails with connection refused / auth errors.

Checks:

1. Container running: `docker start worktrace-postgres` or `docker compose up -d postgres`
2. `DATABASE_URL` in `apps/api/.env` matches compose credentials
   (`worktrace` / `secret` / db `worktrace` on `localhost:5432` in examples)
3. Port `5432` not taken by another Postgres

See root [README.md](../README.md) database section.

## Alembic migration failures

Symptoms: `Can't locate revision`, multiple heads, or upgrade stops mid-chain.

Checks:

1. Work from latest `develop` before adding a revision; set `down_revision` to
   the current **develop** head (see PR template)
2. `cd apps/api && alembic heads` should show a single head for normal work
3. CI runs upgrade -> downgrade base -> upgrade; reproduce locally the same way
4. Do not hand-stamp random revisions on a shared DB without coordinating

Schema contract: `apps/api/app/models.py`, `apps/api/alembic/versions/`,
[docs/db-schema.md](./db-schema.md).

## MinIO bucket or credential problems

Symptoms: screenshot or voice audio upload fails; S3 client errors.

Checks:

1. MinIO container up on `9000` / console `9001`
2. Bucket exists (example name `worktrace-screenshots` in README)
3. `S3_*` values in `apps/api/.env` match `.env.example` for local MinIO

## Missing OpenAI / Anthropic API key

Symptoms: SOP generation or embeddings fail when `LLM_PROVIDER` is not `mock`.

Checks:

1. For local/CI-like behaviour keep `LLM_PROVIDER=mock` and `SOP_GENERATOR=mock`
2. Real providers need keys in env only (never commit them)
3. Read failures in the API process stderr / terminal running `uvicorn`

## ffmpeg not installed (voice feedback)

Symptoms: transcription preprocessing fails when converting uploaded audio.

Checks:

1. Install ffmpeg and ensure it is on `PATH` for the shell that starts the API
2. On Windows, confirm the same terminal used for `pnpm dev:api` sees `ffmpeg -version`

Whisper itself runs in-process; ffmpeg is the usual missing OS dependency.

## macOS screen recording / accessibility permission

Symptoms: Electron capture blank frames or hooks inactive.

Checks: System Settings privacy panes for Screen Recording and Accessibility for
the Electron app / terminal. Documented further in
[docs/spikes/electron-desktop-capture-review.md](./spikes/electron-desktop-capture-review.md).

## Electron global hook initialization failure

Symptoms: desktop capture cannot attach hooks on the OS build in use.

Treat as environment / privilege issue first. Prefer the spike review notes over
assuming a pure application bug. Automated CI does not grant these permissions.

## Where to look at logs

| Surface                   | Where                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| API (local)               | Terminal running `pnpm dev:api` / uvicorn; Python `logging` on modules such as feedback notify/classification |
| Web (local)               | Terminal running Next.js (`pnpm dev:web`)                                                                     |
| Desktop (local)           | Electron main-process terminal / DevTools for renderer                                                        |
| CI                        | GitHub Actions job logs for `web` / `api` / `extension` / `desktop`                                           |
| Deployed web              | Vercel deployment logs                                                                                        |
| Deployed API (AWS target) | CloudWatch noted in [docs/deployment.md](./deployment.md)                                                     |

There is no separate centralized request-id tracing product in-repo; do not
claim one during assessment.

## Related

- [docs/api/api-overview.md](./api/api-overview.md)
- [docs/development/ci-cd.md](./development/ci-cd.md)
- [docs/teamwork-assessment-evidence.md](./teamwork-assessment-evidence.md)
