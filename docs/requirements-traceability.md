# Requirements Traceability Matrix

Maps the project brief and agreed client changes to implementation and evidence.
Status values: `Complete` | `Partial` | `Changed (client-agreed)` | `Out of scope (brief)` | `Not verified`.

| Requirement                                                                   | Source                  | Implementation                                                                       | Evidence                                                                                | Status                  |
| ----------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ----------------------- |
| Module 1: Capture browser workflows (events + screenshots)                    | Brief modules 1-5       | Chrome MV3 extension capture; session ingest API                                     | `apps/extension`, `apps/api` session/ingestion routes; `DEPLOYMENT_GUIDE.md` smoke path | Complete                |
| Module 2: Generate editable SOP from a recording                              | Brief modules 1-5       | LLM / mock SOP generators; review UI                                                 | `apps/api/app/llm_sop_generator.py`, `mock_sop_generator.py`; `/sop/[id]`               | Complete                |
| Module 3: Guided walkthrough on the live page                                 | Brief modules 1-5       | Extension player + web Start walkthrough bridge                                      | `walkthrough-runtime.js`, `extension-bridge.ts`; fixed extension ID in `.env.example`   | Complete                |
| Module 4: Review, approve, publish, shared library                            | Brief modules 1-5       | RBAC review queue + library                                                          | `apps/web` review/library; SOP status machine                                           | Complete                |
| Module 5: Manager analytics (friction, clustering, coaching views)            | Brief modules 1-5       | Friction model, workflow clustering, variance UI                                     | `friction_*.py`, `workflow_clustering.py`, `apps/web/.../dashboard/variance`            | Complete                |
| Tenant isolation of application data                                          | Data architecture       | `tenant_id` on rows; `filter_by_tenant` on routes                                    | `apps/api/app/auth/deps.py`; authenticated route tests                                  | Complete                |
| Operational data stays in the tenant environment                              | Data architecture       | Postgres + MinIO/S3 in deployer-controlled infra                                     | `docker-compose.yml`, `DEPLOYMENT_GUIDE.md` MinIO section                               | Complete                |
| Only embeddings / model calls may leave the tenant boundary                   | Data architecture       | Step embeddings + optional LLM providers; no raw PII in embedding payloads by design | `sop_embeddings.py`, PII masking (`app/pii*`)                                           | Partial                 |
| API keys never appear in API responses                                        | Data architecture       | Secrets via env only; responses omit provider keys                                   | `settings` / env loading; auth and SOP response schemas                                 | Complete                |
| NFR: SOP generation usable within about 60 seconds (typical)                  | Brief NFR               | Async codification job + polling generating page                                     | Generating UI + job status API                                                          | Partial                 |
| NFR: Analytics path handles about 50 sessions within about 5 seconds          | Brief NFR               | Clustering / friction on published sessions                                          | `workflow_clustering.py`, friction calculation                                          | Partial                 |
| NFR: New user can complete core loop in 5 minutes without assistance          | Brief NFR               | Assessor quick start in `DEPLOYMENT_GUIDE.md`                                        | Manual assessor path; not timed in CI                                                   | Not verified            |
| Desktop / Electron capture deferred; browser extension is the capture surface | Client change (Table 4) | Extension is primary; desktop app remains scaffold / spike                           | `apps/extension`; `docs/spikes/electron-desktop-capture-review.md`                      | Changed (client-agreed) |
| Three agent-building demo scenarios (client workflows)                        | Client change           | Demo scenario docs + seeded / recorded SOPs                                          | `docs/demo/` (if present), market-test artefacts                                        | Partial                 |
| Reviewer assignment / grouping of who reviews which SOP                       | Brief / ops expectation | Role is REVIEWER for the whole tenant queue; no per-SOP assignment model             | Review queue filters by role/status only                                                | Partial                 |

## Notes

- Clustering has two floors: `MIN_SESSIONS_FOR_CLUSTERING = 3` in
  `workflow_clustering.py` and `DEFAULT_MIN_SESSIONS = 5` in
  `analytics_clustering.py`. Empty-state copy should not imply a single number.
- Desktop capture is intentionally not the submission capture path.
- "5 minutes unassisted" must stay `Not verified` until a timed dry-run is logged.
