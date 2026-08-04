# System overview

Living overview of the WorkTrace / H09A Apple monorepo as implemented today.
For deployment topology see [docs/deployment.md](../deployment.md) and the
diagram at [docs/architecture/aws-deployment.png](./aws-deployment.png).

## Monorepo layout

| Component                      | Path                                         | Role                                                                                             |
| ------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Web app                        | `apps/web`                                   | Next.js UI: auth, session review, SOP library, review dashboards, marketing pages                |
| API                            | `apps/api`                                   | FastAPI backend: auth, session ingestion, SOP generation, walkthrough, analytics, voice feedback |
| Chrome extension               | `apps/extension`                             | MV3 capture plus the live walkthrough player (guide injected into the third-party page)          |
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

[Web Library / SOP page] --START_WALKTHROUGH--> [Chrome extension]
      --> open target page --> inject walkthrough guide (not a WorkTrace route)

FastAPI
  |- PostgreSQL (sessions, events, sops, users, consent, feedback, ...)
  |- Object storage (screenshots, audio)
  |- Local Whisper (voice feedback transcription)
  |- LLM provider (openai | anthropic | mock) for SOP / embeddings / helpers
  |- Assistant walkthrough helpers used by the extension player
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

## Library search and walkthrough launch

1. Employee opens `/library` (authenticated app shell under `apps/web/src/app/(app)/`).
2. Client filters the published (or draft) SOP list: substring / multi-word title
   search, filter chips, and list/grid view (H09AAPPLE-82). No server-side search
   at current data volumes.
3. Play on a published card (or Start Walkthrough on `/sop/[id]`) calls
   `postExtensionStartWalkthrough(sopId)` in
   `apps/web/src/lib/extension-bridge.ts`.
4. The extension receives `START_WALKTHROUGH`, opens the SOP target page, and
   injects the guide from `apps/extension/src/walkthrough-runtime.js`. Highlighting,
   step advance, Auto/Manual mode, Q&A, and assistant helpers stay in the
   extension (plus API assistant routes). The web app does not render the live
   guide; `apps/web/src/components/floating-assistant/` is unused.

Related schema notes: [docs/db-schema.md](../db-schema.md).

## Implemented vs spike / future work

### Implemented (product paths)

- Auth (JWT, refresh, roles), consent accept/status
- Session ingestion with PII masking
- SOP generation (mock and LLM providers), embeddings path
- Walkthrough APIs, web SOP viewer, and Library search / one-click launch via
  the extension bridge (H09AAPPLE-82)
- Extension walkthrough player on the third-party page (guide bubble, step
  advance; assistant coaching / recover / stuck flows land with H09AAPPLE-80)
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
- Web: `apps/web` (Library: `apps/web/src/app/(app)/library/`)
- Web to extension bridge: `apps/web/src/lib/extension-bridge.ts`
- Extension: `apps/extension` (player: `walkthrough-runtime.js`,
  `START_WALKTHROUGH` in `external-auth.js` / background)
- Desktop: `apps/desktop`

## Related docs

- [docs/git-workflow.md](../git-workflow.md)
- [docs/development/ci-cd.md](../development/ci-cd.md)
- [docs/testing/testing-strategy.md](../testing/testing-strategy.md)
- [docs/security/privacy-design.md](../security/privacy-design.md)
- [docs/teamwork-assessment-evidence.md](../teamwork-assessment-evidence.md)
