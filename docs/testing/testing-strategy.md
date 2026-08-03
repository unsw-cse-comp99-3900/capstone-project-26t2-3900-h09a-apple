# Testing strategy

How this repository validates behaviour. Distinguishes automated CI tests from
manual OS / capture validation. Does **not** use Playwright or other browser E2E
frameworks today.

## Automated tests

### API (pytest)

- Location: `apps/api/tests/`
- Config: `apps/api/pyproject.toml` (`[tool.pytest.ini_options]`)
- CI command: `pytest --cov=app --cov-report=term` (coverage reported; not a hard fail threshold in workflow)
- Also in CI: `ruff check`, `ruff format --check`, Alembic
  `upgrade head` -> `downgrade base` -> `upgrade head`

Representative coverage:

| Area                       | Example tests                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| Auth / JWT / deps          | `test_auth_routes.py`, `test_auth_jwt.py`, `test_auth_deps.py`                             |
| Consent                    | `test_consent_routes.py`                                                                   |
| PII masking                | `test_pii.py`                                                                              |
| Session ingestion          | `test_ingestion.py`                                                                        |
| SOP / LLM fallback         | `test_mock_sop_generator.py`, `test_llm_sop_generator.py`, `test_sop_generator_factory.py` |
| Feedback / Whisper helpers | `test_feedback_routes.py`, `test_feedback_transcription.py`, `test_feedback_voice.py`      |
| Walkthrough / vision       | `test_walkthrough_routes.py`, `test_vision_locate_service.py`                              |
| Analytics / clustering     | `test_analytics_*.py`, `test_workflow_clustering.py`                                       |
| Health / app smoke         | `test_main.py`                                                                             |

Tenant scoping is enforced in route handlers via `filter_by_tenant` in
`apps/api/app/auth/deps.py` and exercised through authenticated route tests
(there is no separate `test_tenant_isolation.py` file).

### Web (Vitest)

- Location: `apps/web/src/**/*.test.ts(x)`
- Config: `apps/web/vitest.config.ts`
- CI: `pnpm --filter @h09a/web test` plus lint, typecheck, format, build

Examples: API client / auth retry helpers, consent storage, SOP viewer,
session review client helpers, variance dashboard client,
`apps/web/src/app/(app)/library/library-search.test.ts` (substring /
multi-word ranking and filter chips), and
`apps/web/src/lib/extension-bridge.test.ts` (`START_WALKTHROUGH` messaging).

Library search and chip filters run client-side over the published (or draft)
SOP list already fetched for `/library`. There is no Playwright (or other
browser E2E) coverage for Library Play today; end-to-end launch is validated
manually with the loaded Chrome extension.

### Extension

- Location: `apps/extension/src/**/*.test.js`
- CI job `extension`: format, lint, typecheck, test, build

Covers walkthrough runtime, session assembly, auth/consent helpers, content
bridge behaviour (including `START_WALKTHROUGH` handling), and related unit
logic.

### Desktop storage package

- Location: `packages/desktop-storage/test/`
- Run from CI `desktop` job: `pnpm --filter @h09a/desktop-storage test`
- Desktop app itself: lint, typecheck, build on Linux runners (native deps installed in CI)

## What CI runs automatically

Workflow: [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)

On pull requests and pushes to `main` and `develop`:

| Job         | Main checks                                             |
| ----------- | ------------------------------------------------------- |
| `web`       | format, lint, typecheck, test, build                    |
| `api`       | ruff, migration up/down/up, pytest with coverage report |
| `extension` | format, lint, typecheck, test, build                    |
| `desktop`   | format, lint, typecheck, desktop-storage tests, build   |

Policy workflows on PRs: `content-policy`, `pr-title`, `commit-policy`.
`visual-evidence` is advisory. `deploy-web` runs only on push to `main`.

See [docs/development/ci-cd.md](../development/ci-cd.md) for required checks
and branch protection.

## Manual validation

### Why Electron / OS capture is mostly manual

Global hooks, screen recording, and accessibility permissions differ by OS and
cannot be reliably automated on shared GitHub-hosted runners. Product claims for
desktop capture should point at written spike evidence rather than CI green alone.

Evidence:

- [docs/spikes/electron-desktop-capture-review.md](../spikes/electron-desktop-capture-review.md)

### Typical local end-to-end (human)

Documented in the root [README.md](../../README.md) Manual verification section:

1. Start Postgres (and MinIO if screenshots/audio objects are needed).
2. Activate API venv, run `pnpm dev`.
3. Build/load extension; record; review/submit via web UI.
4. Confirm generating poll and SOP page; optional DB check.

Auth-protected APIs need a Bearer access token from register/login.

## Out of scope (do not claim)

- Playwright / Cypress browser E2E
- Fully automated Electron permission granting in CI
- Production synthetic monitoring

## Related

- [docs/architecture/system-overview.md](../architecture/system-overview.md)
- [docs/teamwork-assessment-evidence.md](../teamwork-assessment-evidence.md)
