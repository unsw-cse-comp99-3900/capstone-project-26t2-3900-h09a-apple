# Privacy design

Security and privacy practices as implemented in this repository. Prefer the
linked source files over this summary when answering assessment questions.

## Goals

- Authenticate callers with JWT bearer tokens
- Scope data access by tenant and role
- Record user consent for capture-related flows
- Reduce accidental leakage of emails, phones, and secret-like strings before
  session persistence and downstream LLM use
- Keep secrets out of git; load them from environment variables

## Authentication (JWT)

- Issue and verify tokens in `apps/api/app/auth/jwt.py`
- Current user dependency: `get_current_user` in `apps/api/app/auth/deps.py`
- Auth HTTP routes: `apps/api/app/auth/routes.py`
- Tests: `apps/api/tests/test_auth_jwt.py`, `test_auth_routes.py`, `test_auth_deps.py`

Clients send `Authorization: Bearer <access_token>`. Invalid or missing tokens
return HTTP 401.

## RBAC

Roles are ranked employee < reviewer < manager in `require_role`
(`apps/api/app/auth/deps.py`). Route handlers declare the minimum role. Tests
cover forbidden access when the role is too low.

## Tenant filtering

Most tenant-owned tables include `tenant_id`. Query helpers call
`filter_by_tenant(...)` so list/get paths stay inside the caller's tenant.
There is no separate multi-tenant microservice; isolation is application-level
SQL filtering plus authenticated user context.

## Consent

- Routes: `apps/api/app/consent_routes.py` under `/api/v1/consent`
- Accept stores `ConsentAcceptance` rows (user, tenant, type, version, timestamp)
- Status checks the current terms version from `apps/api/app/consent_constants.py`
- Tests: `apps/api/tests/test_consent_routes.py`
- Web/extension also have consent-related unit tests under their own trees

Consent does not by itself encrypt data; it records that the user accepted the
stated terms version before capture/submit flows proceed in the product UI.

## PII masking

- Implementation: `apps/api/app/pii.py`
- Applied during session ingest: `apps/api/app/ingestion.py` calls
  `mask_session_payload` before writing events
- Patterns currently masked in string fields: emails, AU-style phones, and
  `token|password|secret|api_key=` style assignments
- Tests: `apps/api/tests/test_pii.py`

Limitations: masking is heuristic regex, not a full DLP engine. Screenshots and
raw audio are not OCR-redacted by this module.

## What is sent to LLM providers

Controlled by `LLM_PROVIDER` / related env vars (`apps/api/.env.example`).

| Path                                     | Default / notes                                                       | Leaves customer environment?                                                      |
| ---------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| SOP generation                           | `mock` by default locally; `openai` / `anthropic` when configured     | Yes, when a real provider is selected (session-derived text after ingest masking) |
| Embeddings                               | mock vectors when provider is mock; OpenAI-compatible when configured | Yes when real embeddings are enabled                                              |
| Voice feedback transcription             | Local Whisper (`apps/api/app/feedback_transcription.py`)              | No (model runs in the API process)                                                |
| Feedback classification / vision helpers | May call OpenAI-compatible clients when configured                    | Yes when those code paths run with real keys                                      |

Operators should treat enabling `openai` / `anthropic` as an explicit decision:
prompt content can include workflow text derived from captured events (after
masking). Screenshot bytes may be involved in vision locate flows when those
endpoints are used with a live provider.

## What is not sent (by design of current defaults)

- With `LLM_PROVIDER=mock` and `SOP_GENERATOR=mock`, SOP generation and embedding
  helpers stay deterministic / local for development and CI
- Whisper transcription for voice feedback is local to the API host
- Database credentials and API keys are read from environment variables, not
  committed (see `.gitignore` and `*.env.example` templates)

## Secrets management

- Templates: `.env.example`, `apps/api/.env.example`, `apps/web/.env.example`,
  `apps/desktop/.env.example`
- Runtime secrets: `SECRET_KEY`, `DATABASE_URL`, `OPENAI_API_KEY`,
  `ANTHROPIC_API_KEY`, S3/MinIO keys, OAuth client secrets, etc.
- Cloud notes: AWS Secrets Manager called out in [docs/deployment.md](../deployment.md)
- Never commit real `.env` files

## Local Whisper vs third-party API boundary

- **Local:** `whisper` model load/transcribe for voice feedback audio on the API
  process (`preload_whisper_model` in app lifespan)
- **Third-party:** OpenAI-compatible or Anthropic HTTP APIs for SOP text,
  embeddings, and some classification/vision helpers when enabled

ffmpeg may be required on the host to normalize audio before transcription; that
is an operational dependency, not a cloud transcription vendor.

## Current limitations

- PII masking does not cover all locales or free-text secrets inside screenshots
- Tenant isolation depends on correct use of `filter_by_tenant` on each query path
- No dedicated `security.yml` audit workflow in CI yet (do not claim one)
- No production claim of end-to-end encryption of object storage beyond provider defaults
- Desktop global capture privacy UX still relies on OS permission dialogs and
  manual validation (see Electron spike doc)

## Related tests and docs

- `apps/api/tests/test_pii.py`
- `apps/api/tests/test_consent_routes.py`
- `apps/api/tests/test_auth_*.py`
- [docs/architecture/system-overview.md](../architecture/system-overview.md)
- [docs/testing/testing-strategy.md](../testing/testing-strategy.md)
- [docs/teamwork-assessment-evidence.md](../teamwork-assessment-evidence.md)
