# Sprint 1 Database Schema

**Ticket:** H09AAPPLE-15 · [BE/DB] Design Sprint 1 database schema
**Owner:** Zixing Qiu (Gary) · **Status:** In Progress
**Blocked by:** H09AAPPLE-21 (dev env), H09AAPPLE-17 (event schema spike)
**Blocks:** H09AAPPLE-12 (session assembly), H09AAPPLE-14 (ingestion)

This document is the agreed data contract for Sprint 1. The extension, the
FastAPI backend, and the frontend all build against it. Field names map 1:1
onto `packages/types/src/session.ts` and `apps/api/app/models.py`.

---

## Relationships

```
sessions ──1:N── events ──0:1── screenshots
    │                              │
    │              (events.screenshot_id only;
    │               screenshots do NOT FK back to events)
    │
    └────────1:N──── sops          (deletion is RESTRICT, not cascade)
```

- A **session** is one recorded run of a workflow.
- A session has many **events** (ordered by `seq`, append-only).
- An event may reference one **screenshot**; the FK is one-way (events → screenshots).
- A session may produce many **sops** (re-generation bumps `version`); sops are
  intentionally preserved when their session is soft-deleted.

---

## Conventions

- **Identifier strategy**
  - `sessions.id`, `screenshots.id`, `sops.id` — `UUID` (`gen_random_uuid()`).
    These IDs travel between the extension, backend, and FE.
  - `events.id` — `BIGINT IDENTITY`. Events are the hot/large table; UUID PKs
    cause index bloat and insert fragmentation.
- **Timestamps and time zones** — three formats coexist on purpose:
  - `events.timestamp_ms` — `bigint`, Unix epoch milliseconds, captured by the
    content script. Time-zone-agnostic by definition.
  - `events.occurred_at` — `timestamptz`, **generated** from `timestamp_ms`
    (`to_timestamp(timestamp_ms / 1000.0)`). Stored UTC, presented in the
    session's locale by the FE.
  - All other `timestamptz` columns (`sessions.started_at`, `stopped_at`,
    `created_at`, `deleted_at`, `ingested_at`, `generated_at`, …) are stored
    UTC by Postgres.
  - **Wire format:** every `timestamptz` field MUST be serialised as ISO-8601
    with an explicit UTC offset, e.g. `2026-06-16T12:30:00Z` or
    `2026-06-16T22:30:00+10:00`. Naive strings (no offset) are rejected by
    Pydantic on ingestion. The FE / extension MUST NOT send wall-clock strings
    without an offset.
- **Enums** — modelled as `varchar(32)` + `CHECK` constraints, **not** Postgres
  native ENUMs. Rationale: event/SOP/session types will keep growing
  (`tab_switch`, `keypress`, `scroll`, …) and native ENUMs are painful to
  evolve (`ALTER TYPE ... ADD VALUE` cannot run in a transaction).
- **Deletion semantics**
  - `sessions` — soft delete via `deleted_at TIMESTAMPTZ`. Hard-delete is an
    ops procedure, not an app concern.
  - `events`, `screenshots` — `ON DELETE CASCADE` from session (only triggered
    when a session is hard-deleted).
  - `sops` — `ON DELETE RESTRICT`. SOPs are LLM-generated assets (~60s of
    compute each); they must be detached or deleted explicitly.
- **Idempotency** — every write that originates from the extension carries a
  `client_session_id` (UUID). The extension's flush is retried after
  service-worker crashes; without this key we get duplicate sessions.
- **PII annotations** live in two places: this document **and** `COMMENT ON
COLUMN` statements in the migration. The DB comment is the single source of
  truth for tooling.

---

## Wire-format rules (cross-layer contracts)

These rules bind the **extension → API** and **API → FE** layers to the same
serialisation choices. They are not enforced by the DB; the API layer
(H09AAPPLE-14) MUST implement them.

### Identifier serialisation

| DB type                | JSON type | Reason                                                                                                                                  |
| ---------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `UUID`                 | `string`  | Standard 36-char form.                                                                                                                  |
| `BIGINT` (`events.id`) | `string`  | JS `number` is only safe up to 2^53 - 1. Sending as `string` keeps FE arithmetic safe even though we won't realistically hit the limit. |

The API MUST serialise `events.id` as a JSON string, e.g. with a Pydantic
`field_serializer` or by typing the response model field as `str`. The TS
contract in `packages/types/src/session.ts` already declares `id: string`; the
API and the TS type cannot disagree.

### Sequence number (`events.seq`) assignment

**The server assigns `seq`.** The extension does NOT include `seq` in its
upload payload (see `WTEventInput` in `packages/types/src/session.ts`); the
API computes it on insert as

```
seq = row_number() OVER (PARTITION BY session_id
                         ORDER BY ingested_at, id) - 1
```

(or the equivalent transactional counter).

Rationale: if the extension owned `seq`, it would need to persist a counter
across service-worker terminations (which are routine in MV3). On crash +
restart the counter would reset to 0, the first re-inserted event would
collide with the existing `UNIQUE(session_id, seq)` constraint, and the whole
flush would fail. Server-side assignment makes the extension stateless and
the contract crash-safe.

`seq` appears in the **read** DTO `WTEvent` (returned by GET endpoints) but
not in the **write** DTO `WTEventInput` (sent by the extension).

---

## Scope deviations from the Jira card

The Jira ticket H09AAPPLE-15 listed exact column lists. The implementation
deviates from those lists on purpose. Every deviation is summarised here so
the team can ratify (and so the Jira card gets updated to match).

| Change                                                                         | Where         | Direction | Reason                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------ | ------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Removed `pii_masked BOOLEAN`                                                   | `sessions`    | dropped   | Masking is enforced at capture (H09AAPPLE-11); a column that is always `true` carries no signal and a `false` value would imply the backend tolerates unmasked PII. If we ever need per-session masking-version audit, we add `masking_version VARCHAR` instead. |
| Added `client_session_id UUID UNIQUE`                                          | `sessions`    | added     | Idempotency key for extension flush retries. Without it, a service-worker crash during flush writes duplicate sessions.                                                                                                                                          |
| Added `deleted_at TIMESTAMPTZ`                                                 | `sessions`    | added     | Soft-delete; lets generated SOPs survive their source session.                                                                                                                                                                                                   |
| Loosened `recorded_by` to nullable                                             | `sessions`    | softened  | Auth/users table is out-of-scope for Sprint 1; extension has no real user UUID to attach yet. Will be tightened to `NOT NULL` when auth lands.                                                                                                                   |
| Added `attrs JSONB`                                                            | `events`      | added     | Open bag for `aria-role`, `href`, `name`, etc. Avoids one migration per new capture field.                                                                                                                                                                       |
| Added `occurred_at TIMESTAMPTZ GENERATED`                                      | `events`      | added     | Cheap time-range queries / joins to `sessions.started_at`. Zero maintenance cost.                                                                                                                                                                                |
| Added `ingested_at TIMESTAMPTZ`                                                | `events`      | added     | Server-side wall clock; detects client clock skew.                                                                                                                                                                                                               |
| `events.id` is `BIGINT IDENTITY`, not UUID                                     | `events`      | changed   | Events is the hot/large table; UUID PKs bloat indexes and fragment inserts. Other PKs stay UUID.                                                                                                                                                                 |
| `value`, `target_selector`, `target_label`, `url` are `TEXT`, not `VARCHAR(N)` | `events`      | changed   | `value` has a CHECK `length <= 10000`; the others are unbounded. PG `TEXT` and `VARCHAR(N)` are storage-equivalent.                                                                                                                                              |
| Removed `event_id UUID`                                                        | `screenshots` | dropped   | The FK is one-way (`events.screenshot_id`); a back-link is circular and requires two-sided maintenance.                                                                                                                                                          |
| Added `width / height / bytes`                                                 | `screenshots` | added     | Useful metadata for FE rendering; trivial cost.                                                                                                                                                                                                                  |
| Added `warnings JSONB`                                                         | `sops`        | added     | Mirrors `SopWarning` in `apps/api/app/sop_schema.py`; keeps DB and Pydantic models in sync.                                                                                                                                                                      |
| `sops` FK uses `ON DELETE RESTRICT`                                            | `sops`        | changed   | SOPs are LLM-generated assets (~60s of compute); cascading their deletion with their source session is destructive-by-default.                                                                                                                                   |
| Status enums modelled as `VARCHAR(32) + CHECK`, not native `ENUM`              | all           | changed   | Native `ENUM`s cannot have values added inside a transaction, which makes evolving them (`tab_switch`, `keypress`, `scroll` …) painful.                                                                                                                          |

---

## Table: `sessions`

| Column              | Type         | Null | Default             | PII     | Notes                                                                       |
| ------------------- | ------------ | ---- | ------------------- | ------- | --------------------------------------------------------------------------- |
| `id`                | uuid         | no   | `gen_random_uuid()` | —       | PK                                                                          |
| `client_session_id` | uuid         | no   | —                   | —       | **UNIQUE**, idempotency key from extension                                  |
| `tenant_id`         | uuid         | no   | —                   | —       | indexed; org scope                                                          |
| `recorded_by`       | uuid         | yes  | —                   | **PII** | links to a user; indexed. Nullable until auth lands — see Scope deviations. |
| `workflow_name`     | varchar(200) | no   | —                   | —       | user-entered, non-empty                                                     |
| `status`            | varchar(32)  | no   | `recording`         | —       | enum below                                                                  |
| `started_at`        | timestamptz  | no   | —                   | —       |                                                                             |
| `stopped_at`        | timestamptz  | yes  | —                   | —       | null while recording; `>= started_at`                                       |
| `event_count`       | int          | no   | `0`                 | —       | denormalised count, `>= 0`                                                  |
| `created_at`        | timestamptz  | no   | `now()`             | —       |                                                                             |
| `deleted_at`        | timestamptz  | yes  | —                   | —       | soft-delete marker                                                          |

**Indexes:**

- `pk_sessions(id)`
- `uq_sessions_client_session_id(client_session_id)` — UNIQUE
- `ix_sessions_tenant_started(tenant_id, started_at DESC)` partial WHERE `deleted_at IS NULL`
- `ix_sessions_user_started(recorded_by, started_at DESC)` partial WHERE `deleted_at IS NULL`

**Allowed `status` values:** `recording` · `captured` · `submitted` · `processed` · `failed`.

---

## Table: `events`

| Column            | Type        | Null | Default     | PII          | Notes                                                            |
| ----------------- | ----------- | ---- | ----------- | ------------ | ---------------------------------------------------------------- |
| `id`              | bigint      | no   | `IDENTITY`  | —            | PK                                                               |
| `session_id`      | uuid        | no   | —           | —            | FK → sessions, **CASCADE**                                       |
| `seq`             | int         | no   | —           | —            | order within session, `>= 0`                                     |
| `type`            | varchar(32) | no   | —           | —            | enum below                                                       |
| `target_selector` | text        | yes  | —           | —            | stable CSS selector                                              |
| `target_label`    | text        | yes  | —           | **PII-risk** | on-screen text; may expose data                                  |
| `value`           | text        | yes  | —           | **PII**      | **masked before write** (see -11); `length <= 10000`             |
| `url`             | text        | yes  | —           | **PII-risk** | may carry ids in query string                                    |
| `attrs`           | jsonb       | no   | `'{}'`      | —            | open bag for `aria-role`, `href`, `name`, …                      |
| `screenshot_id`   | uuid        | yes  | —           | —            | FK → screenshots, **SET NULL**                                   |
| `timestamp_ms`    | bigint      | no   | —           | —            | capture epoch ms, `> 0`                                          |
| `occurred_at`     | timestamptz | no   | _generated_ | —            | `GENERATED ALWAYS AS (to_timestamp(timestamp_ms/1000.0)) STORED` |
| `ingested_at`     | timestamptz | no   | `now()`     | —            | server-side, used to detect clock skew                           |

**Constraints:** `uq_events_session_seq UNIQUE(session_id, seq)`.

**Indexes:**

- `pk_events(id)`
- `uq_events_session_seq(session_id, seq)`
- `ix_events_session_type(session_id, type)`
- `ix_events_occurred_brin USING BRIN(occurred_at)` — cheap time-range scans on append-only data

**Allowed `type` values:** `click` · `navigation` · `input` · `submit` · `tab_switch`.

---

## Table: `screenshots`

| Column       | Type         | Null | Default             | PII          | Notes                                                                               |
| ------------ | ------------ | ---- | ------------------- | ------------ | ----------------------------------------------------------------------------------- |
| `id`         | uuid         | no   | `gen_random_uuid()` | —            | PK                                                                                  |
| `session_id` | uuid         | no   | —                   | —            | FK → sessions, **CASCADE**, indexed                                                 |
| `object_key` | varchar(500) | no   | —                   | **PII-risk** | **UNIQUE**, key in object storage                                                   |
| `width`      | int          | yes  | —                   | —            | px, optional                                                                        |
| `height`     | int          | yes  | —                   | —            | px, optional                                                                        |
| `bytes`      | bigint       | yes  | —                   | —            | size in bytes, optional (BIGINT — long full-page screenshots can exceed INT4 ~2 GB) |
| `created_at` | timestamptz  | no   | `now()`             | —            |                                                                                     |

The image blob lives in object storage (uploaded by H09AAPPLE-14). The DB
stores only the key.

---

## Table: `sops`

| Column            | Type         | Null | Default             | PII          | Notes                                                      |
| ----------------- | ------------ | ---- | ------------------- | ------------ | ---------------------------------------------------------- |
| `id`              | uuid         | no   | `gen_random_uuid()` | —            | PK                                                         |
| `session_id`      | uuid         | no   | —                   | —            | FK → sessions, **RESTRICT**, indexed                       |
| `title`           | varchar(300) | no   | —                   | —            |                                                            |
| `version`         | int          | no   | `1`                 | —            | bumps on regenerate / edit, `>= 1`                         |
| `status`          | varchar(32)  | no   | `draft`             | —            | enum below                                                 |
| `steps`           | jsonb        | no   | `'[]'`              | **PII-risk** | step text may echo captured data; `jsonb_typeof = 'array'` |
| `warnings`        | jsonb        | no   | `'[]'`              | —            | matches `SopWarning` in `apps/api/app/sop_schema.py`       |
| `generated_at`    | timestamptz  | no   | `now()`             | —            |                                                            |
| `gen_duration_ms` | int          | yes  | —                   | —            | proves the <60s budget, `>= 0`                             |

**Constraints:** `uq_sops_session_version UNIQUE(session_id, version)`.
**Indexes:** `ix_sops_session_status(session_id, status)`.
**Allowed `status` values:** `draft` · `needs_review` · `approved` · `published`.

### `steps` JSONB shape

The shape must match `SopStep` in `apps/api/app/sop_schema.py` (Pydantic) —
those two definitions are the same contract from two angles. **Do not diverge
field names.**

```json
[
  {
    "order": 1,
    "title": "Open the invoices dashboard",
    "instruction": "Click Invoices in the left navigation.",
    "source_event_ids": ["12345", "12346"]
  }
]
```

### `warnings` JSONB shape

Matches `SopWarning` in `sop_schema.py`:

```json
[
  {
    "type": "repeated_action",
    "message": "Step 3 was performed twice in a row.",
    "source_event_ids": ["12350", "12351"]
  }
]
```

---

## PII summary (AC5)

| Field                        | Classification | Handling                                                                                                             |
| ---------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------- |
| `sessions.recorded_by`       | PII            | reference only (UUID); nullable until auth lands; never display raw to managers/executives                           |
| `sessions.client_session_id` | Low            | opaque idempotency key, not user-derived                                                                             |
| `events.value`               | PII            | masked at capture (H09AAPPLE-11); `[MASKED]` for email / id / date patterns; `type="password"` fields never captured |
| `events.target_label`        | PII-risk       | on-screen text; covered by capture-time `<label>`-aware extraction                                                   |
| `events.url`                 | PII-risk       | query strings may carry ids/emails; URL masking deferred to ingestion in H09AAPPLE-14                                |
| `events.attrs`               | PII-risk       | application-controlled bag; reviewers must whitelist what goes in                                                    |
| `screenshots.object_key`     | Low            | opaque key; the image itself is PII and is served via short-lived signed URLs only                                   |
| `sops.steps`                 | PII-risk       | generated from masked input; reviewer can redact before publish                                                      |

These classifications are mirrored in the migration as `COMMENT ON COLUMN`
statements so downstream tooling (DataDog, schema docs, audit scripts) can read
them directly.

---

## Out of scope (H09AAPPLE-15 — historical)

- `tenants` table and full auth UX — `users` landed in H09AAPPLE-42; login in H09AAPPLE-43
- Analytics / feedback tables
- Partitioning of `events` (needed past ~10M rows; not Sprint 1)
- Archival to cold storage
- Server-side URL masking (lives in H09AAPPLE-14)

---

## Deliverables checklist

- [x] `apps/api/app/models.py` — SQLAlchemy models (4 tables, status enums as Python `enum.Enum` mapped to `VARCHAR + CHECK`)
- [x] `apps/api/alembic/` — initialised; `alembic/env.py` wired to `app.models.Base.metadata` and reads `DATABASE_URL` from the env
- [x] `apps/api/alembic/versions/0001_init.py` — initial migration. Includes:
  - `CREATE EXTENSION IF NOT EXISTS pgcrypto`
  - the `events.occurred_at` generated column (autogenerate cannot reliably emit `GENERATED ALWAYS AS`)
  - the BRIN index on `events.occurred_at`
  - all `COMMENT ON COLUMN` PII annotations
- [x] `packages/types/src/session.ts` — shared TS interfaces, with **separate In/Out DTOs** (`WTEventInput` vs `WTEvent`, `SessionUploadPayload` vs `SessionDetail`)
- [x] `docs/db-schema.md` — this document, reviewed by the team
- [x] PII fields annotated (above) **and** mirrored in DB via `COMMENT ON COLUMN`

### Running the migration

```bash
cd apps/api

# Render the full upgrade as SQL without a DB (smoke test):
DATABASE_URL='postgresql+psycopg://u:p@localhost:5432/dummy' \
  alembic upgrade head --sql

# Apply against a real database:
export DATABASE_URL='postgresql+psycopg://USER:PASSWORD@HOST:5432/DBNAME'
alembic upgrade head        # AC2: runs cleanly on a fresh DB
alembic downgrade base      # full rollback also clean
```

The migration is wrapped in a single `BEGIN ... COMMIT` transaction (Postgres
supports transactional DDL), so a failure halfway leaves the schema unchanged.

---

## Migration policy (team)

Schema changes must stay in sync across the repo, CI, and every developer's
database. Follow this whenever a ticket touches `models.py` or Postgres.

1. **One PR, one revision** — ship an Alembic file in `apps/api/alembic/versions/`
   together with `models.py` changes. Do not hand-edit local Postgres without a
   migration.
2. **Chain from `main` head** — new revisions must set `down_revision` to the
   current head on `main` (check with `alembic heads`; there must be only one).
   Rebase before opening a PR if `main` moved.
3. **No `tenants` table** — `tenant_id` is a plain `UUID` column for row isolation,
   not a foreign key. Dev default: `DEFAULT_TENANT_ID` / `22222222-2222-2222-2222-222222222222`.
4. **Verify on a fresh DB** — before merge: `alembic upgrade head` on an empty
   database (local Docker Postgres or CI).
5. **CI** — `alembic upgrade head` runs on every `api` job PR (ephemeral Postgres
   spun up in `.github/workflows/ci.yml`).
6. **Document contract changes** — update this file when table/column semantics
   change; keep `packages/types` in sync when API wire format changes.
7. **Multiple heads** — if two branches both add migrations from the same parent,
   merge with `alembic merge` or rebase so the chain is linear before merging to
   `main`.

PR authors: tick the database checklist in `.github/pull_request_template.md`
when the PR touches schema.

---

## Table: `users` (H09AAPPLE-42)

| Column            | Type         | Null | Default             | Notes                                      |
| ----------------- | ------------ | ---- | ------------------- | ------------------------------------------ |
| `id`              | uuid         | no   | `gen_random_uuid()` | PK                                         |
| `email`           | varchar(255) | no   | —                   | **UNIQUE**                                 |
| `hashed_password` | varchar(255) | no   | —                   | bcrypt via passlib                         |
| `role`            | varchar(32)  | no   | —                   | `EMPLOYEE` · `REVIEWER` · `MANAGER`        |
| `tenant_id`       | uuid         | no   | —                   | logical org scope; **no FK** to `tenants`  |
| `created_at`      | timestamptz  | no   | `now()`             |                                            |

**Revision:** `0003_users_and_sop_tenant` also adds `sops.tenant_id` (backfilled
from `sessions.tenant_id`). `sessions.tenant_id` already existed from Sprint 1.

**Auth utilities (same ticket):** `generate_token` / `verify_token` (python-jose,
HS256, 24h, `SECRET_KEY` env), `get_current_user` FastAPI dependency (JWT
`user_id` → DB lookup; 401 if missing/invalid). Login/register routes are
H09AAPPLE-43.
