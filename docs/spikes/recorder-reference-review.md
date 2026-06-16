# Capture Layer Reference Review

**Spike — H09AAPPLE-17 · [Tech Spike - FE] Review reference session recorder implementation**

|                |                                                                       |
| -------------- | --------------------------------------------------------------------- |
| **Epic**       | H09AAPPLE-8 Reference Research & Architecture                         |
| **Author**     | Xingzhi Li (Icey)                                                     |
| **Status**     | Decisions locked; pending PR merge                                    |
| **Time-box**   | 1 day maximum                                                         |
| **Blocked by** | H09AAPPLE-21 (monorepo)                                               |
| **Unblocks**   | H09AAPPLE-10 (click & navigation), H09AAPPLE-11 (input capture + PII) |

> **Purpose.** Decide, with evidence from open-source session recorders (rrweb, OpenReplay), how the WorkTrace Chrome extension will intercept events, select click targets, mask input, capture screenshots, and shape the session event payload. This is a one-page engineering decision document. It does **not** cover product UI, other modules, or implementation code.

> **How to use this doc.** Each section has a **Findings** part (what rrweb / OpenReplay do) and a **Decision** part (what WorkTrace will do + one-line rationale). Once the doc is reviewed via PR and linked on the downstream cards (-10 / -11 / -12 / -14) as required reading, this spike is done.

---

## Scope of this spike

**In scope** — answer these five questions only:

1. Event interception approach
2. Selector strategy for click targets
3. Input masking pattern
4. Screenshot capture via `chrome.tabs.captureVisibleTab`
5. Recommended session event schema (aligned with H09AAPPLE-15)

**Out of scope** — full open-source library integration · implementation code · performance benchmarking · product/UI design · backend storage.

**Reference material** — rrweb (`github.com/rrweb-io/rrweb`) · OpenReplay tracker (`github.com/openreplay/openreplay`) · Chrome Extension MV3 docs.

---

## 1. Event interception approach

**Question:** How should the content script intercept user events inside the recorded page?

### Findings — rrweb / OpenReplay

- **rrweb** (`packages/rrweb/src/record/observer.ts`): `record()` attaches listeners on `document` in **capture phase**. It builds a single full DOM snapshot at start, then emits `IncrementalSnapshot` (event type `3`) for every change, with a `source` enum discriminating Mutation / MouseInteraction / Input / Scroll / etc. Continuous streams (`mousemove`, `scroll`, `resize`) are throttled (default ~50 ms). DOM mutations are observed via `MutationObserver`; navigation is intercepted by patching `history.pushState` / `replaceState`.
- **OpenReplay tracker** (`tracker/src/main/`): same shape — capture-phase listeners on `document`, full DOM snapshot, then incremental events, with batching and serialisation pushed onto a Web Worker before the WebSocket emit. Sanitisation runs **before** events leave the page context.
- **MV3 constraint:** content scripts run in an isolated world per page; the **service worker is ephemeral** — Chrome terminates it after ~30 s idle and revives it on the next event. `chrome.runtime.sendMessage` is the standard channel from content script to service worker, but **in-memory state in the service worker is lost on restart**, so a buffer must be persisted (e.g. `chrome.storage.session`).

### Decision — WorkTrace

- Listen on `document` in the **capture phase** for `click`.
- Intercept navigation by patching `history.pushState` / `replaceState` and listening to `popstate` / `hashchange` (SPA) plus full page loads (traditional). **De-duplicate** when a single user navigation fires more than one signal within a short window (e.g. a `pushState` that also triggers `popstate`).
- Emit each event to the **background service worker** via `chrome.runtime.sendMessage`; the service worker holds the active session buffer.
- **Persist the buffer in `chrome.storage.session`** keyed by `session_id` so a service-worker restart doesn't drop events. The in-memory buffer is a write-through cache over storage.
- **Recording state lives in the service worker + `chrome.storage`, never in the popup.** The MV3 popup is destroyed on every focus loss, so it cannot own state. The content script reads the recording-state flag from `chrome.storage` (initial read + `chrome.storage.onChanged`) and gates capture on it, so capture continues while the popup is closed. The popup, when re-opened, reads the same state to render live status and the running event count.
- **Crash recovery:** on `chrome.runtime.onStartup` / `onInstalled` the service worker resets any stale `RECORDING` flag to idle, so a browser crash mid-session never silently auto-resumes capture on the next launch.
- No full DOM mirror for Sprint 1 — we capture discrete interaction events, not a replayable DOM stream.

**Rationale:** capture-phase listeners are the simplest reliable approach in an MV3 content script and match rrweb's interception model; a full DOM snapshot is unnecessary for SOP generation and adds large payload + privacy cost; `chrome.storage.session` is the standard MV3 fix for the service-worker termination gap; making the popup a thin switch is forced by Chrome's transient-popup behaviour, and the explicit crash-reset prevents the only failure mode where capture could resume without user intent.

---

## 2. Selector strategy for click targets

**Question:** How do we identify the element a user clicked, stably and readably?

### Findings — rrweb / OpenReplay

- **rrweb** (`packages/rrweb-snapshot/src/snapshot.ts`): every DOM node is assigned an integer `id` via the **mirror** at snapshot time; subsequent events reference that id, not a selector. The id is meaningless without the snapshot, so rrweb's selector strategy is **not directly reusable** for a non-replay product.
- **OpenReplay / industry common practice:** generate a CSS path bottom-up with a stable preference order — `#id` if unique → stable `data-*` attribute → tag + `nth-of-type` walked toward the nearest identifiable ancestor; truncate at `body` or a root with an id. The same pattern shows up in `getCssPath`-style helpers across multiple recorders.

### Decision — WorkTrace

- Generate a **stable CSS selector** with this preference order:
  1. `#id` if present and unique
  2. `[data-testid]` / stable `data-*` attribute
  3. `nth-of-type` path from the nearest identifiable ancestor
- Additionally capture a human-readable `target_label`: visible text → `aria-label` → `placeholder` → `title`.

**Rationale:** the CSS selector gives uniqueness for analytics/diffing; the readable label drives SOP step titles ("Click **Submit invoice**"), which is what makes the generated SOP human-readable.

---

## 3. Input masking pattern

**Question:** How do we capture form input at field level without ever recording sensitive data?

### Findings — rrweb / OpenReplay

- **rrweb** (`packages/rrweb/src/record/observers/input.ts`):
  - `maskAllInputs` (boolean, default `false`) — when `true`, every input value is replaced with asterisks before emit.
  - `maskInputOptions` — per-input-type fine control. **`password: true` is the default**; rrweb never emits the real value of a password field even when `maskAllInputs` is `false`.
  - `maskTextClass` / `maskTextSelector` — opt-in: any element matching the class or selector has its text/value masked.
  - Masking happens **inside the recorder**, before the event is queued for emit.
- **OpenReplay**:
  - Module-level opt-ins `obscureTextEmails`, `obscureTextNumbers`.
  - Per-element runtime attributes (`data-openreplay-hidden`, `data-openreplay-obscured`, `data-openreplay-masked`) that the tracker scans for and applies sanitisation.
  - Custom selector lists for project-specific PII fields configured via the SDK.

### Decision — WorkTrace

- Debounce `input` / `change` events at **300 ms**; record the field's final value only.
- **Never** capture `type="password"` fields — they produce no event at all.
- Apply masking **before** the value enters the buffer:
  - Email pattern → `[MASKED]`
  - Long numeric / customer-ID pattern → `[MASKED]`
  - Configurable PII selector blocklist read from extension storage
- Masking logic lives in an isolated, unit-testable function.

**Rationale:** masking at the point of capture (never store then scrub) is the only design that satisfies the enterprise privacy requirement in -11; rrweb's default-mask-passwords stance confirms this is the safe baseline.

---

## 4. Screenshot capture (`chrome.tabs.captureVisibleTab`)

**Question:** When and how do we capture screenshots, and how do we keep them small and safe?

### Findings — reference / Chrome MV3

- **`chrome.tabs.captureVisibleTab(windowId?, options?)`** must be called from the **extension context** (service worker or popup) — content scripts cannot call it. Requires `activeTab` (granted on user gesture / extension click) **or** host permission for the captured URL. The API is **rate-limited** (`MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND` in Chromium source — in practice ~2 calls/second). It returns a data URL of the **visible viewport only** (off-screen content not captured); format defaults to PNG, with `{ format: "jpeg", quality: 0–100 }` available to shrink payload.
- **rrweb does not screenshot** — it reconstructs the DOM on replay. For WorkTrace screenshots are **evidence for SOP step rendering**, not for visual replay, so frequency is decided by SOP value (state changes, submissions) rather than fidelity.

### Decision — WorkTrace

- Capture on **navigation events and form submit only** — not on every click.
- Format: JPEG, quality ~70, to keep payload small.
- Store the image by reference: each screenshot gets a `screenshot_id` linked to the triggering event; blobs upload separately (see -14), only the id/key travels in the event stream.
- Respect a privacy flag — a screenshot can be excluded if the page is marked sensitive.

**Rationale:** screenshots at meaningful state changes give the SOP visual context at minimal payload cost; per-click capture would explode size and hit the `captureVisibleTab` rate limit.

---

## 5. Recommended session event schema

**Question:** What is the canonical shape of a captured event and session? (Must align with H09AAPPLE-15 DB schema.)

### Findings

- **rrweb event envelope** (`packages/types`): `{ type, data, timestamp }` where `type` is the top-level enum `0–6` (`DomContentLoaded` / `Load` / `FullSnapshot` / `IncrementalSnapshot` / `Meta` / `Custom` / `Plugin`). User interactions live inside `IncrementalSnapshot` (type `3`) with a `data.source` enum (`MouseInteraction` = 2, `Input` = 5, `Scroll` = 3, …). The envelope is optimised for **full visual replay**, not for procedural segmentation.
- **Mapping to WorkTrace's needs:** the AI pipeline only needs the discrete user actions that translate to SOP steps — click / navigation / input (form fields) / submit. Continuous streams (mousemove, scroll, mutation deltas) and binary DOM diffs add no value for SOP generation. → a **flat, discriminated event type indexed by `seq`** is sufficient and far simpler to store.

### Decision — WorkTrace event contract

```ts
// One captured event (buffered in the service worker, ordered by seq)
type WTEvent = {
  seq: number; // monotonic order within session
  type: 'click' | 'navigation' | 'input' | 'submit';
  target_selector?: string; // stable CSS selector (§2)
  target_label?: string; // human-readable label (§2)
  value?: string; // already masked (§3)
  url?: string; // for navigation events
  screenshot_id?: string; // reference only (§4)
  timestamp_ms: number;
};

// The assembled session payload (produced on Stop — see H09AAPPLE-12)
type WTSessionPayload = {
  session_id: string;
  workflow_name: string;
  recorded_by: string;
  started_at: number;
  stopped_at: number;
  event_count: number;
  pii_masked: true;
  events: WTEvent[];
};
```

**Alignment note:** field names map 1:1 onto the `sessions` and `events` tables in H09AAPPLE-15. Shared TypeScript types will live in `packages/types/session.ts` and be consumed by the extension (-10/-11/-12) and the backend (-14). The actual file is added under -10 (or a small follow-up), not in this spike.

**Rationale:** a flat, discrete event model (not an rrweb DOM stream) is the minimum the AI pipeline needs to segment a session into SOP steps, and it keeps the storage schema simple.

---

## Open questions for downstream implementers

- Should rapid repeated clicks on the same target be de-duplicated at capture time, or only at session assembly (-12)?
- Do we capture scroll events in Sprint 1? _(Current decision: no — out of scope.)_
- Confirm the `data-*` attribute name we standardise on for selector stability.
- **Tab scope:** only the tab that was active when the user pressed Start, or every tab while recording? _(Sprint 1 default proposal: only the active tab.)_

---

## Definition of done

- [x] Findings filled for all five sections from rrweb / OpenReplay review.
- [x] All five Decisions locked.
- [x] `WTEvent` / `WTSessionPayload` is the source of truth for H09AAPPLE-15 schema (same author).
- [x] Doc shared in the team channel and linked on H09AAPPLE-10 / -11 / -12 / -14 as required reading before those cards start.
- [x] Time-box respected (1 day).

---

_Spike H09AAPPLE-17 · Team H09A_APPLE · `docs/spikes/recorder-reference-review.md`_
