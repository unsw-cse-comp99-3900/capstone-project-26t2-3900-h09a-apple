# System overview

Living overview of the WorkTrace / H09A Apple monorepo as implemented today.
For deployment topology see [docs/deployment.md](../deployment.md) and the
diagram at [docs/architecture/aws-deployment.png](./aws-deployment.png).

## Monorepo layout

| Component                      | Path                                         | Role                                                                                             |
| ------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Web app                        | `apps/web`                                   | Next.js UI: auth, session review, SOP library, review dashboards, marketing pages                |
| API                            | `apps/api`                                   | FastAPI backend: auth, session ingestion, SOP generation, walkthrough, analytics, voice feedback |
| Chrome extension               | `apps/extension`                             | MV3 capture of browser workflows; still used for web-page recording paths                        |
| Desktop (Electron)             | `apps/desktop`                               | Desktop capture / walkthrough player direction; OS hooks and permissions are harder to automate  |
| Shared types / storage helpers | `packages/types`, `packages/desktop-storage` | Shared TypeScript contracts and local buffer / capture-policy helpers                            |
| PostgreSQL + pgvector          | Docker / RDS                                 | Primary datastore, embeddings support                                                            |
| MinIO (local) / S3 (cloud)     | object storage                               | Screenshots and voice feedback audio objects                                                     |
| Redis (optional)               | Docker / CI service                          | Analytics response cache when `REDIS_URL` is set                                                 |
| LLM providers                  | env-selected                                 | SOP generation, embeddings, some classification / vision helpers                                 |

## Runtime architecture (logical)

```
[Chrome extension] --capture--> [Web review UI] --submit--> [FastAPI]
[Electron desktop] --capture--> [local buffer]  --sync----> [FastAPI]

FastAPI
  |- PostgreSQL (sessions, events, sops, users, consent, feedback, ...)
  |- Object storage (screenshots, audio)
  |- Local Whisper (voice feedback transcription)
  |- LLM provider (openai | anthropic | mock) for SOP / embeddings / helpers
```

Cloud-oriented view (web on Vercel, API on ECS Fargate, RDS, S3) is documented
in [docs/deployment.md](../deployment.md).

## Capture to SOP data flow

1. **Capture** events (and optional screenshots) in the extension or desktop app.
2. **Review** in the web UI (`/session/review`), then submit a session payload.
3. **Ingest** via `POST /api/v1/sessions` (`apps/api/app/main.py`,
   `apps/api/app/ingestion.py`). PII masking runs before persistence.
4. **Store** session/events in PostgreSQL; screenshots go to object storage when present.
5. **Generate SOP** via `POST /api/v1/sessions/{session_id}/generate-sop` using
   `SOP_GENERATOR` / `LLM_PROVIDER` (`mock` by default in local `.env.example`).
6. **Review / publish** SOP in the web UI; walkthrough and analytics build on stored SOPs.

Related schema notes: [docs/db-schema.md](../db-schema.md).

## Implemented vs spike / future work

### Implemented (product paths)

- Auth (JWT, refresh, roles), consent accept/status
- Session ingestion with PII masking
- SOP generation (mock and LLM providers), embeddings path
- Walkthrough APIs and web SOP viewer flows
- Voice feedback upload, local Whisper transcription, classification helpers
- Analytics / clustering routes (see `apps/api/app/analytics_*`)
- CI for web, API, extension, desktop; Vercel web deploy on `main`

### Spike / evidence (not full product automation)

- Electron desktop capture feasibility and OS permission constraints:
  [docs/spikes/electron-desktop-capture-review.md](../spikes/electron-desktop-capture-review.md)
- OCR / vision decision spike under `spikes/`

### Future or partial

- Production backend URL and full AWS cutover details still evolving in
  [docs/deployment.md](../deployment.md) (some fields marked TBD)
- Friction / advanced desktop global-hook automation remains limited by OS policy;
  prefer manual validation records over claiming full E2E coverage

## Key code entry points

- API app: `apps/api/app/main.py`
- Auth and tenant helpers: `apps/api/app/auth/`
- Ingestion + PII: `apps/api/app/ingestion.py`, `apps/api/app/pii.py`
- SOP providers: `apps/api/app/llm_sop_generator.py`, `apps/api/app/mock_sop_generator.py`
- Local compose services: `docker-compose.yml`
- Web: `apps/web`
- Extension: `apps/extension`
- Desktop: `apps/desktop`

## Related docs

- [docs/git-workflow.md](../git-workflow.md)
- [docs/development/ci-cd.md](../development/ci-cd.md)
- [docs/testing/testing-strategy.md](../testing/testing-strategy.md)
- [docs/security/privacy-design.md](../security/privacy-design.md)
- [docs/teamwork-assessment-evidence.md](../teamwork-assessment-evidence.md)
