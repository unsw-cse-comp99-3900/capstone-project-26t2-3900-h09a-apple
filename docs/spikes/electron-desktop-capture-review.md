# Electron Desktop Capture - Architecture Design (H09AAPPLE-69)

**Status:** Design from H09AAPPLE-69; **Windows validation complete** (H09AAPPLE-70). **macOS
validation pending** - see §7. Do not treat design assumptions as final until §7.4 macOS rows are
filled in.

**Context:** Full background on why this pivot happened (client confirmed Clicky-style
desktop-wide capture, not browser-only) is in `docs/decisions/electron-desktop-pivot.md`. This
document covers the technical design only.

## 1. Three-module breakdown

1. **Module 1 - Workflow Recorder**: capture global desktop events (Windows first, then macOS)
   and resolve what was interacted with (element identification).
2. **Module 2 - Data Pipeline**: local buffering of captured events before submission to the
   existing backend.
3. **Module 3 - Guided Interaction**: play back a generated SOP as an on-screen highlight guide,
   ending with the user having configured their own Claude Code agent.

Final delivery question (not yet answered): a desktop app + the existing Chrome extension. The
extension can be embedded/linked from unblox.ai via URL redirect (`worktrace.unblox.ai`, already
hosted on Vercel per DNS lookup - see project memory). Whether the desktop app needs its own
public landing page, a downloadable installer bundle on unblox.ai, or something else, is not yet
decided.

## 2. Module 1 - Capture pipeline design

### 2.1 Why the browser extension's approach doesn't carry over

The Chrome extension identifies elements via CSS selector / XPath - a DOM concept. Desktop apps
have no DOM. Clicky's own reference pipeline (screenshot → OCR → LLM → SOP) replaces DOM lookup
with screen-based recognition instead.

### 2.2 Layered element identification (accuracy vs resource cost tradeoff)

Per-click, two cheap methods run **concurrently**, with an expensive third method as a
**conditional fallback** (not run by default - only triggered when the first two fail):

```
Step 1 (concurrent):
  ├─ OS Accessibility API query at click coordinates
  │    → returns element name/role/bounding box if the target app exposes it
  └─ Local OCR on a small crop around the click point (e.g. ~200x200px)
       → returns nearby text if any is present

  If either succeeds with a non-empty result → use it, done. No Step 2.

Step 2 (conditional, only if Step 1 fully fails  -  e.g. icon-only button, or an app that
doesn't expose its accessibility tree, such as game engines, canvas-rendered UIs like some
CAD/design tools, or unmaintained legacy software):
  └─ Full-screen screenshot, sent to a vision model for semantic identification
       → broader context helps identify icon-only elements Step 1 couldn't
```

**Screenshot timing (important, fixes a real bug in an earlier draft of this design):** both the
local crop AND the full-screen screenshot are captured **at the moment of the click**, held
briefly in memory - not re-captured later if Step 1 fails. This guarantees the full-screen image
reflects the exact on-screen state at click time, not a stale state captured after Step 1's
processing delay. If Step 1 succeeds, both images are discarded from memory without ever being
written to disk. Only if Step 2 triggers does the full-screen image get used (and then discarded
after processing).

### 2.3 Why local crop, not full-screen, for Step 1

- **Size**: a small crop is KBs; a full screenshot is hundreds of KB to MBs. Step 1 runs on every
  click - using full-screen here would balloon transient memory/CPU cost for no benefit.
- **OCR precision**: a full-screen image with many buttons confuses "which text belongs to the
  click" - a tight crop removes that ambiguity.
- **Step 2 needs the opposite property**: when Step 1's narrow crop yields nothing (icon with no
  text), a vision model needs _more_ surrounding context to guess the icon's meaning (e.g. "this
  icon is next to a row of file-operation icons, so it's probably delete") - hence full-screen only
  at that stage.

### 2.4 What OCR is and isn't used for (clears up a real design confusion from earlier drafts)

- **Per-click element identification**: OCR runs locally, on the small crop, cheap and fast - this
  is _not_ an LLM call. It just extracts nearby text.
- **Per-session SOP generation**: understanding "what is this whole recording about" is a
  **separate, session-level step, done once after recording stops** - not per click. This reuses
  the existing Module 2 LLM SOP generator architecture (H09AAPPLE-24) unchanged: it consumes the
  full ordered event list once recording ends, not a stream of per-click LLM calls. Calling an LLM
  once per click to ask "what is this session about" was considered and rejected - the AI cannot
  meaningfully answer that question from a single isolated click, and the cost (N clicks = N LLM
  calls) doesn't buy anything useful.

### 2.5 Decision (H09AAPPLE-73): local OCR + local-first vision; no external screenshots by default

**Decision (2026-07-16):** keep element-identification inference **on-device by default**, matching
the local-Whisper precedent (H09AAPPLE-31) and the brief's tenant-residency requirement.

Empirical harness: `spikes/ocr-vision-decision/` (5 synthetic crops, ground truth in
`fixtures/ground-truth.json`). Same images for every engine. Host for the measured run: Windows
dev laptop (stronger than typical pilot hardware); treat latencies as optimistic. Full table:
`spikes/ocr-vision-decision/results/SUMMARY.md`.

Moondream2 was the first local VLM candidate because it is small, fast, and practical to run via
Ollama on a pilot laptop without a dedicated GPU. SmolVLM, Qwen2-VL-7B-Instruct, and Llama vision
variants were not benchmarked in this pass; stronger local VLMs are a follow-up. This card closes
the local-first vs external compliance decision, not production model selection.

| Tier                            | Choice                                                               | Evidence                                                                                                                                      |
| ------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Step 1 OCR (crop text)          | **Local `tesseract.js`**                                             | 3/5 cases passed against ground truth; warm ~8-50 ms; cold worker load ~0.3-0.7 s; $0; no pixels leave the device                             |
| Step 2 vision (icon / OCR-miss) | **Local-first architecture; current `moondream` (Ollama) not ready** | Moondream 1/5 pass; outputs often garbled. GPT-4o vision 5/5, warm ~0.8-1.1 s, ~$0.0008/call via OpenRouter - but raw crops leave the machine |
| When local Step 2 fails         | Store `identification_source=unidentified` + raw coordinates (§2.6)  | Prefer an incomplete local event over an external screenshot upload                                                                           |

**Integration approach (Electron, follow-up implementation card):**

1. Run **Tesseract.js** in the Electron main/utility process on the click crop (Step 1, concurrent
   with Accessibility API).
2. Keep a **local VLM slot** for Step 2 (Ollama sidecar or a bundled model). Re-benchmark before
   locking a production model; moondream2 failed this harness and must not be treated as done.
3. Bound Step 2 with a timeout; on miss/timeout, fall through to `unidentified` (never drop the
   event).
4. **Do not** call GPT-4o / Claude / other external vision APIs on raw desktop screenshots in the
   default product path.

**Team flag:** finding a local VLM that beats ~1/5 on icon/toolbar cases is open engineering work
(timeline/cost). That does **not** reopen external APIs as the default. If a customer later demands
external vision accuracy, that is an explicit opt-in exception under the redaction rules in §3.5 -
not the baseline design.

### 2.6 Never silently drop an event (failure handling)

Every event must be stored regardless of whether identification succeeded, matching the pattern
already established for H09AAPPLE-68's storage error handling (explicit terminal state, never a
silent gap):

```
try {
  step1 = accessibilityAPI() + localOCR()   // concurrent
  if (step1 failed) {
    try {
      step2 = fullScreenScreenshot() -> visionModel()   // with timeout
      store(event, content = step2.success ? step2.result : "unidentified" + raw coordinates)
    } catch (step2 error/timeout) {
      store(event, content = "unidentified" + raw coordinates)
    }
  } else {
    store(event, content = step1.result)
  }
} catch (unexpected failure anywhere in the pipeline) {
  store(event, content = "unidentified", flagged as error)
}
```

The `identification_source` field on every event record must always be set - one of
`accessibility_api | ocr | vision_model | unidentified` - never left blank. This is also useful
telemetry later: it lets the team measure what fraction of events each tier actually resolves, to
judge whether the layered approach is working as intended.

### 2.7 Electron vs Tauri - decision: Electron

|           | Electron                                                                                                                                  | Tauri                                     |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Language  | JS/TS (team's existing stack)                                                                                                             | Rust + JS (nobody on the team knows Rust) |
| Dev speed | Fastest                                                                                                                                   | Slower                                    |
| Ecosystem | Mature: `uiohook-napi` (global input hooks), `active-win` (foreground window detection), Electron `desktopCapturer` (full-screen capture) | Smaller, more custom native code needed   |
| Footprint | ~100MB                                                                                                                                    | ~5-10MB                                   |

Given the timeline and team skillset, footprint is not the deciding factor - shipping is. Electron
chosen. Revisit only if H09AAPPLE-70 surfaces an Electron-specific hard blocker.

### 2.8 Platform order: Windows first, then macOS

Team has more Windows dev machines / familiarity. macOS Accessibility and Screen Recording
permission flows are expected to be more restrictive and are the top known risk - H09AAPPLE-70
explicitly validates both platforms rather than deferring macOS testing to the end, specifically to
avoid discovering a macOS blocker late.

## 3. Module 2 - Data pipeline / local storage design

### 3.1 Storage choice: SQLite (better-sqlite3), not IndexedDB, not raw JSON files

- **Not IndexedDB**: it's a Web/browser API. Electron's global capture logic (`uiohook-napi` etc.)
  runs in the **main process** (Node.js), which cannot access IndexedDB (that only exists in a
  renderer/browser context). Routing every capture write through IPC to a hidden renderer just to
  reach IndexedDB adds complexity for no benefit.
- **Not raw JSON files** (one file per session): reimplements exactly the class of bug already
  fixed in H09AAPPLE-68 for the Chrome extension - no built-in way to query/sort/evict without
  manually scanning the filesystem and parsing every file's metadata.
- **SQLite** gives cap-eviction and cleanup almost for free: `DELETE FROM sessions WHERE id = ?`,
  `SELECT * FROM sessions ORDER BY stopped_at ASC LIMIT N` for eviction, transactional writes (no
  partial-write corruption).

### 3.2 Backend contract is unchanged

SQLite is local buffer only. Final submission to the backend still assembles the same structured
session JSON and POSTs to the existing `POST /api/v1/sessions` - the backend does not need to know
or care whether a session originated from the Chrome extension or the desktop app.

### 3.3 Time field taxonomy (four distinct categories, do not conflate)

| Category                          | Field(s)                                     | Notes                                                                                                                                                                 |
| --------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Event timestamp                   | `events.event_timestamp`                     | Ground truth - when the click/keypress actually happened, ms precision. Screenshots are bound to this time, not to when processing finished.                          |
| Session lifecycle                 | `sessions.started_at`, `sessions.stopped_at` | `stopped_at` is the sort key for cap-eviction (oldest evicted first).                                                                                                 |
| Submission                        | `sessions.submitted_at`                      | Set only once `POST /api/v1/sessions` succeeds - this is the trigger for local deletion, distinct from `stopped_at` (user may not submit immediately after stopping). |
| Processing (optional, debug-only) | `events.processed_at`                        | When identification actually completed; useful for spotting performance bottlenecks (`processed_at - event_timestamp`), not required for core functionality.          |

### 3.4 Schema

**`sessions` table**

| Field           | Type                                            | Required | Notes                                                        |
| --------------- | ----------------------------------------------- | -------- | ------------------------------------------------------------ |
| `session_id`    | string (PK/UUID)                                | yes      |                                                              |
| `workflow_name` | string                                          | yes      |                                                              |
| `started_at`    | timestamp(ms)                                   | yes      |                                                              |
| `stopped_at`    | timestamp(ms)                                   | no       | empty while recording, set on stop                           |
| `submitted_at`  | timestamp(ms)                                   | no       | empty until submit succeeds; triggers local cleanup when set |
| `status`        | enum: `recording` \| `completed` \| `submitted` | yes      |                                                              |
| `platform`      | enum: `windows` \| `macos`                      | yes      |                                                              |

**`events` table**

| Field                           | Type                                                                    | Required           | Notes                                                                                                  |
| ------------------------------- | ----------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------ |
| `event_id`                      | string (PK/UUID)                                                        | yes                |                                                                                                        |
| `session_id`                    | string (FK → sessions)                                                  | yes                |                                                                                                        |
| `event_type`                    | enum (§4)                                                               | yes                |                                                                                                        |
| `event_source`                  | enum: `user` \| `system` \| `app`                                       | yes                | three-layer classification, see §4.1                                                                   |
| `event_layer`                   | enum: `desktop` \| `browser` \| `web_app` \| `file_system` \| `backend` | yes                |                                                                                                        |
| `event_category`                | string                                                                  | yes                | e.g. `mouse`, `keyboard`, `window`, `file`                                                             |
| `event_timestamp`               | timestamp(ms)                                                           | yes                | ground truth time, see §3.3                                                                            |
| `foreground_app`                | string                                                                  | no                 | required for `APP_FOCUS`/`APP_SWITCH`-type events, else optional                                       |
| `coordinate_x` / `coordinate_y` | int                                                                     | no                 | absent for non-positional events                                                                       |
| `payload_json`                  | JSON                                                                    | yes (default `{}`) | event-type-specific fields - see §4 rationale for why this is a flexible column, not fixed ones        |
| `identification_source`         | enum: `accessibility_api` \| `ocr` \| `vision_model` \| `unidentified`  | yes, always set    | never blank, see §2.6                                                                                  |
| `is_identified`                 | boolean                                                                 | yes                |                                                                                                        |
| `screenshot_ref`                | string                                                                  | no                 | discarded from memory after processing in the normal case; only persisted for rare manual-review cases |
| `processed_at`                  | timestamp(ms)                                                           | no                 | debug-only, see §3.3                                                                                   |

**Why `payload_json` instead of many fixed columns:** the event taxonomy (§4) spans dozens of
types (`POINTER_CLICK`, `TAB_OPEN`, `FILE_SELECT`, `CLIPBOARD_COPY`, ...) each needing different
fields (`button`/`clickCount` vs `tabId`/`url` vs `fileName`/`fileExt`). A flat table with one
column per possible field across all types would be extremely sparse. `payload_json` holds the
type-specific fields; this already matches the pattern the Chrome extension's `background.js` uses
today (`payload: { ...message.payload, ...(screenshotId ? { screenshot_id: screenshotId } : {}) }`)

- not a new pattern, a continuation of an existing one.

### 3.5 Redaction / residency implications of §2.5

**Default path (chosen):** Step 1 OCR and Step 2 vision stay local. Module 2 does **not** need an
egress redaction pipeline for identification screenshots, because those pixels never leave the
device for model inference. Session submit to `POST /api/v1/sessions` remains the existing
structured JSON path (already used by the extension); that is product backend traffic, not a
third-party vision vendor.

**If an external vision API is ever enabled (opt-in exception only - not the default):**

1. **Never upload full-screen captures** to the vendor. Send only a tight crop around the click
   (same crop size class as Step 1, e.g. ~200x200), after local checks fail.
2. **Pre-flight local redaction on the crop:** mask password fields / known secret patterns when
   Accessibility exposes them; strip or blur regions that look like text fields with high ink
   density if role is unknown; drop the call entirely if the foreground app is on a deny list
   (password managers, banking, etc.).
3. **No raw image retention at the vendor:** use APIs with zero retention / no training where
   contractually available; log only that an external call occurred (timestamp, model, crop hash),
   not the pixels.
4. **Customer / tenant control:** off by default; enable only with written acceptance that cropped
   UI pixels leave the tenant boundary.
5. **Cost:** GPT-4o vision measured ~$0.0008 per identification call on this harness; at scale this
   is a recurring opex line, separate from accuracy.

Because §2.5 chose local-first, items (1)-(5) are **contingency design**, not the build plan for
the first desktop capture slice.

## 4. Event taxonomy

Three layers of classification per event:

```json
{ "source": "user", "layer": "desktop", "category": "mouse", "type": "click" }
```

- `source`: who triggered it - `user` | `system` | `app`
- `layer`: where it happened - `desktop` | `browser` | `web_app` | `file_system` | `backend`
- `category`: what kind of object - e.g. `mouse`, `keyboard`, `window`, `file`, `clipboard`
- `type`: the specific event type (tables below)

Events fall into three top-level groups: **SystemEvent**, **DesktopEvent**, **BrowserEvent**.

### 4.1 SystemEvent

| Type                    | Description                                                                                                                                                               | Suggested fields                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `SESSION_START`         | Recording started                                                                                                                                                         | `sessionId`, `startedBy`              |
| `SESSION_END`           | Recording ended                                                                                                                                                           | `sessionId`, `durationMs`             |
| `USER_NOTE`             | User manually added a note                                                                                                                                                | `note`, `timestamp`                   |
| `USER_MARK_STEP`        | User manually flagged a key step                                                                                                                                          | `label`, `description`                |
| `USER_PAUSE_RECORDING`  | User paused                                                                                                                                                               | `reason`                              |
| `USER_RESUME_RECORDING` | User resumed                                                                                                                                                              | `reason`                              |
| `SYSTEM_NOTIFICATION`   | A system notification appeared                                                                                                                                            | `title`, `message`, `appName`         |
| `SYSTEM_ERROR`          | System-level error                                                                                                                                                        | `message`, `errorCode`, `appName`     |
| `PERMISSION_PROMPT`     | Initial permission request shown to user                                                                                                                                  | `permissionType`, `appName`, `result` |
| `PERMISSION_REVOKED`    | A previously-granted permission was revoked mid-session (distinct from the initial prompt - detected by polling permission state before each capture-dependent operation) | `permissionType`, `appName`           |
| `AUTH_REQUIRED`         | Login/auth prompt encountered                                                                                                                                             | `appName`, `url`, `authType`          |
| `NETWORK_OFFLINE`       | Connection lost                                                                                                                                                           | `connectionType`                      |
| `NETWORK_ONLINE`        | Connection restored                                                                                                                                                       | `connectionType`                      |
| `SYSTEM_LOCK`           | Screen locked                                                                                                                                                             | `lockedAt`                            |
| `SYSTEM_UNLOCK`         | Screen unlocked                                                                                                                                                           | `unlockedAt`, `lockedDurationMs`      |

`SYSTEM_LOCK`/`SYSTEM_UNLOCK` matter for accuracy: locked-screen time should not count toward
active session duration. `PERMISSION_REVOKED` matters because the app needs to know capture has
silently stopped working if a user revokes Accessibility/Screen Recording permission mid-session -
this must pause capture and surface an explicit error, not keep "recording" nothing.

### 4.2 DesktopEvent

| Type                  | Description                                                                                                                                                                                       | Suggested fields                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `POINTER_CLICK`       | Left/right/double click - distinguished by fields, not separate types                                                                                                                             | `button` (left/right), `clickCount` (1/2), `x`, `y`, `target` |
| `POINTER_DRAG`        | Drag, start + end coordinates                                                                                                                                                                     | `startX`, `startY`, `endX`, `endY`, `target`                  |
| `SCROLL`              | Scroll; consecutive scrolls within 500ms merged into one event                                                                                                                                    | `direction`, `deltaX`, `deltaY`, `durationMs`                 |
| `KEYPRESS`            | Single key press                                                                                                                                                                                  | `key`, `code`, `modifiers`                                    |
| `TEXT_INPUT`          | Continuous text input, should be merged/coalesced                                                                                                                                                 | `textMasked`, `charCount`, `fieldLabel`                       |
| `HOTKEY`              | Shortcut combo, e.g. Ctrl+C / Cmd+S. Windows first, macOS mapping added later                                                                                                                     | `keys`, `normalized`                                          |
| `CLIPBOARD_COPY`      | Copy action - **do not capture clipboard content, not even masked** (see rationale below)                                                                                                         | `contentType`, `sourceApp`                                    |
| `CLIPBOARD_PASTE`     | Paste action - same rationale                                                                                                                                                                     | `contentType`, `targetApp`                                    |
| `FOCUS_CHANGE`        | Focus change, either between apps or between windows within the same app - merged from earlier separate `WINDOW_FOCUS`/`APP_FOCUS` drafts to avoid duplicate/noisy events on ambiguous boundaries | `appName`, `windowTitle`, `windowId`, `isAppSwitch` (bool)    |
| `WINDOW_OPEN`         | New window opened                                                                                                                                                                                 | `appName`, `windowTitle`, `windowId`                          |
| `WINDOW_CLOSE`        | Window closed                                                                                                                                                                                     | `appName`, `windowTitle`, `windowId`                          |
| `APP_LAUNCH`          | Application started                                                                                                                                                                               | `appName`, `processName`                                      |
| `APP_EXIT`            | Application exited                                                                                                                                                                                | `appName`, `processName`                                      |
| `FILE_SELECT`         | File chosen in a file picker                                                                                                                                                                      | `fileName`, `fileExt`, `pathMasked`                           |
| `FILE_OPEN`           | File opened                                                                                                                                                                                       | `fileName`, `fileExt`, `pathMasked`                           |
| `FILE_SAVE`           | File saved                                                                                                                                                                                        | `fileName`, `fileExt`, `pathMasked`                           |
| `FILE_UPLOAD`         | File uploaded                                                                                                                                                                                     | `fileName`, `fileExt`, `targetApp`                            |
| `FILE_DOWNLOAD`       | File downloaded                                                                                                                                                                                   | `fileName`, `fileExt`, `sourceUrl`                            |
| `DIALOG_OPEN`         | System/app dialog appeared                                                                                                                                                                        | `dialogTitle`, `dialogType`, `appName`                        |
| `DIALOG_CLOSE`        | Dialog closed                                                                                                                                                                                     | `dialogTitle`, `result`                                       |
| `SCREENSHOT_CAPTURED` | A screenshot was persisted (audit marker for when Step 2's fallback actually fired and kept an image)                                                                                             | `imageId`, `reason`, `region`                                 |

**Why `CLIPBOARD_COPY`/`CLIPBOARD_PASTE` must not read clipboard content, not even masked:**
"masked" implies the raw content was read into memory first, then redacted before storage - this
still means the app touched potentially highly sensitive data (a password manager copy is a classic
case) before deciding to discard it. Safer design: never call the clipboard content API at all,
only observe that a copy/paste action occurred and which app was source/target. No content, no
exposure window, no masking logic needed.

**Why `FOCUS_CHANGE` replaces separate `WINDOW_FOCUS`/`APP_FOCUS` types from an earlier draft:**
the boundary between "window focus changed within the same app" and "focus switched to a different
app" was ambiguous and risked firing both events for the same real action, or firing very frequently
for multi-window apps. A single event with an `isAppSwitch` boolean is simpler and avoids double
counting.

### 4.3 BrowserEvent

**Scope note (decided, does not touch existing shipped code):** this table applies **only** to the
desktop app's own browser detection - i.e. when the desktop app's foreground-app check finds the
user is in a browser and uses Accessibility API/OCR to interpret what's happening inside it. **The
existing Chrome extension (`apps/extension`) is not touched by this taxonomy** - it continues
emitting its existing three types (`CLICK` / `NAVIGATION` / `INPUT`) unchanged. Rewriting the
extension's capture code to match this richer taxonomy would touch already-shipped, Demo-B-critical
code for no immediate benefit and is explicitly out of scope right now.

The two pipelines are distinguished by an `event_source` tag: `extension` (existing Chrome
extension) vs `desktop_browser_detection` (new desktop app's browser-focused capture). They run in
parallel without being unified. Whether to eventually retire the extension pipeline in favor of the
desktop one is a decision for after the desktop app ships, not now.

| Type                | Description                | Suggested fields                        |
| ------------------- | -------------------------- | --------------------------------------- |
| `TAB_OPEN`          | New tab opened             | `tabId`, `url`, `title`                 |
| `TAB_CLOSE`         | Tab closed                 | `tabId`, `url`, `title`                 |
| `TAB_SWITCH`        | Tab switched               | `fromTabId`, `toTabId`, `url`           |
| `URL_CHANGE`        | URL changed                | `fromUrl`, `toUrl`, `title`             |
| `PAGE_LOAD`         | Page finished loading      | `url`, `title`, `durationMs`            |
| `DOM_CLICK`         | Click on a page element    | `selector`, `text`, `role`, `tagName`   |
| `DOM_INPUT`         | Input into a page field    | `selector`, `fieldLabel`, `valueMasked` |
| `DOM_SUBMIT`        | Form submitted             | `formId`, `formName`, `actionUrl`       |
| `DOM_SELECT`        | Dropdown selection         | `selector`, `optionText`, `valueMasked` |
| `DOM_CHECK`         | Checkbox/radio checked     | `selector`, `label`                     |
| `DOM_UNCHECK`       | Checkbox/radio unchecked   | `selector`, `label`                     |
| `DOM_HOVER`         | Hover over an element      | `selector`, `text`, `role`              |
| `DOWNLOAD_START`    | Browser download started   | `fileName`, `url`, `mimeType`           |
| `DOWNLOAD_COMPLETE` | Browser download completed | `fileName`, `pathMasked`, `fileSize`    |
| `BROWSER_ERROR`     | Browser/page-level error   | `message`, `url`, `errorType`           |

## 5. Module 3 - Guided interaction (design sketch only, not detailed - deliberately deprioritized)

Module 3 has not been designed to the same depth as Modules 1-2, by deliberate choice - it doesn't
block current work (H09AAPPLE-70/71/72 don't need it), and one open product question needs
answering first (see §5.3) before detailed design is worth doing.

### 5.1 Highlight rendering can't reuse the browser extension's approach

CORRECTION: an earlier draft of this section said the extension injects `outline`/`outline-offset`
CSS directly onto the target element. Having now read the actual H09AAPPLE-28 branch code
(`apps/extension/src/walkthrough-runtime.js`), that is not what it does. Real mechanism: a Shadow
DOM host element (`position: fixed; inset: 0`, max z-index, `pointer-events: none` except the
tooltip) is injected into `document.documentElement`. Inside it, a `.highlight` div is positioned
via `getBoundingClientRect()` on the resolved target, styled with a border plus a large
`box-shadow: 0 0 0 9999px rgba(...)` - this dims the entire rest of the page, producing a
spotlight effect around the target, not just an outline on it. A tooltip (instruction text,
screenshot preview, Previous/Next/Finish buttons) is positioned near the highlight via a
`placeTooltip()` function that flips above/below and clamps to viewport edges to avoid overflow.

No equivalent DOM/Shadow-DOM concept exists for arbitrary desktop apps. Replacement: a
transparent, always-on-top OS-level overlay window, positioned using screen coordinates, drawn on
top of the target app rather than injected into it. The **visual language should be carried over**
(spotlight dimming + positioned tooltip with the same button set) even though the rendering
mechanism must change - this is a proven, already-shipped UX pattern, not something to redesign
from scratch.

### 5.1a What else in walkthrough-runtime.js maps directly to the desktop design

Read in full to extract reusable patterns before designing Module 3's real implementation:

- **`resolveAnchorMode(step)`** already reads a `step.anchor_mode` field (`element` \|
  `screenshot` \| `none`), falling back to deriving it from whether `css_selector`/`xpath` exist,
  then from whether `screenshot_url` exists. This is the exact `anchor_mode` design discussed for
  the H09AAPPLE-27 422 fix (see H09AAPPLE-28's Jira comments) - it is **already implemented on the
  frontend**, the remaining gap is purely backend (the API needs to stop erroring and start
  returning steps with `anchor_mode: "screenshot"` or `"none"` instead of a 422). Desktop's version
  of `resolveAnchorMode` should use the same three-value enum, just backed by
  `accessibility_api`/`ocr`/`vision_model`/`unidentified` instead of css/xpath/screenshot.
- **Graceful no-target fallback already exists**: when `resolveTarget()` fails, the tooltip
  recenters via `viewportCenterRect()` and shows a `fallback-note` ("No on-page target for this
  step. Showing captured preview.") instead of erroring. Desktop's overlay should do the same -
  center the guidance window on screen when no element can be located, rather than failing.
- **Reposition-on-change**: `MutationObserver` (DOM changes) + `scroll`/`resize` listeners trigger
  `scheduleReposition()` → `reposition()`. Desktop has no DOM to observe - §5.4's polling-based
  auto-advance mechanism needs to also drive re-positioning when it detects a state change, not
  just step advancement.
- **State is storage-driven, not function-call-driven**: step state lives in
  `chrome.storage.session`, and a `storage.onChanged` listener is the single trigger for
  re-rendering - avoids desync between "what triggered a change" and "what renders." Desktop's
  equivalent (SQLite row change, or an in-process event emitter) should follow the same
  single-source-of-truth pattern.
- **Telemetry hook**: `enterCurrentStep()` sends a `WALKTHROUGH_STEP_ENTERED` message with
  `entered_at`, deduplicated so re-entering the same step index doesn't double-fire - this feeds
  H09AAPPLE-30's friction tracking. Desktop Module 3 needs an equivalent hook once built, feeding
  the same downstream friction-score pipeline (Module 5 doesn't care which platform produced the
  event, per the existing capture-layer-agnostic backend contract).

### 5.2 Playback-time re-identification reuses the same three-layer approach as capture

Screen resolution, window size, or app version may differ between the recording machine and the
playback machine, so the target element's coordinates from recording time won't necessarily be
valid at playback time. Playback re-runs the same layered lookup as §2.2 (Accessibility API +
local OCR concurrently, vision model as conditional fallback) to re-locate the logical target on
the new screen - this is the same mechanism reused for a different purpose, not a new one.

### 5.3 RESOLVED (H09AAPPLE-78): what "the user has built their own agent" produces

Per the client's definition ("an agent is not code, it is a well-written instruction in a plain
text file") and because this product has no agent-execution engine, Finish exports the finished
prompt only: if the walkthrough included a prompt-coaching step (H09AAPPLE-50), assemble the five
validated sections (Identity / Context / Steps / Output / Guardrails) into one markdown document
and offer save-to-file + copy-to-clipboard. WorkTrace does not execute, schedule, or run the agent.
If there was no coaching step, the completion screen has no export action.

Implementation lives under `apps/desktop/src/main/walkthrough/` (overlay BrowserWindow + same
spotlight/tooltip visual language as the extension). Auto-advance first pass uses the global input
hook; Accessibility-tree diff remains follow-up (§5.4). Voice advance is a fixed vocabulary
(`next` / `continue` / `previous` / `repeat` / `stop`) over the H09AAPPLE-32 STT path when present.

### 5.4 Auto-advance ("has this step been completed") needs a new detection mechanism

The extension detects step completion via DOM changes / page navigation. No DOM exists at desktop
level. Replacement approach (not yet validated): poll foreground app/window state, or poll the
Accessibility tree for a state change in the target region (e.g. a button's state changing from
unselected to selected). Needs its own design pass once Module 3 is picked back up.

## 6. Summary of open decisions (blocking further design work, not blocking H09AAPPLE-70/71/72)

1. ~~Local vs external model for OCR/vision analysis~~ - **Decided in H09AAPPLE-73** (§2.5 / §3.5):
   local Tesseract.js for OCR; local-first vision; no external screenshot APIs by default;
   moondream not production-ready yet (follow-up model selection).
2. ~~What "the user has built their own agent" concretely means~~ - **Resolved in H09AAPPLE-78**
   (§5.3): export the validated five-section prompt file; do not execute the agent.
3. Whether to eventually retire the Chrome extension's browser capture pipeline in favor of the
   desktop app's, once the desktop app ships (§4.3) - deliberately deferred, not urgent.

## 7. Validation Results (H09AAPPLE-70)

**Prototype:** `spikes/electron-capture-poc/` (throwaway Electron app, not monorepo-integrated).  
**Log format:** `{ event_type, timestamp, foreground_app, window_title, screenshot_ref, ... }` →
`output/events.log` (local only, gitignored).

### 7.1 AC point 1 - Global click/key capture (uiohook-napi)

| Platform    | Result        | Notes                                                                                                                                                   |
| ----------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Windows** | **Confirmed** | Hidden Electron window; global `CLICK` / `KEYDOWN` received while using Edge, Code editor, Claude, Explorer. Manual session logged thousands of events. |
| **macOS**   | _Pending_     | Run `npm install && npm start` on Mac; expect Accessibility prompt (§7.4).                                                                              |

### 7.2 AC point 2 - Foreground app / window title (active-win)

| Platform    | Result        | Notes                                                                                                                                                                  |
| ----------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Windows** | **Confirmed** | `active-win` prebuilt binary works inside Electron **without** `electron-rebuild`. Example apps logged: `Microsoft Edge`, `Code editor`, `Claude`, `Windows Explorer`. |
| **macOS**   | _Pending_     | Swift helper binary; verify after Accessibility grant.                                                                                                                 |

### 7.3 AC point 3 - Full-screen screenshot per event (desktopCapturer, 500ms throttle)

| Platform    | Result        | Notes                                                                                                                                                                                                                            |
| ----------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Windows** | **Confirmed** | `desktopCapturer.getSources({ types: ['screen'], thumbnailSize: 1920x1080 })` writes PNG per event; throttle reuses `screenshot_ref` within 500ms (same idea as `SCREENSHOT_THROTTLE_MS` in `apps/extension/src/background.js`). |
| **macOS**   | _Pending_     | May require Screen Recording permission; document in §7.4.                                                                                                                                                                       |

**Caveat:** `thumbnailSize` caps resolution - acceptable for spike; production may need native-resolution capture.

### 7.4 AC point 4 - macOS permission friction

| Permission       | When triggered   | User steps | Restart required? | Screenshots                                             |
| ---------------- | ---------------- | ---------- | ----------------- | ------------------------------------------------------- |
| Accessibility    | _TBD on Mac run_ | _TBD_      | _TBD_             | _Add under `docs/spikes/permission-screenshots/macos/`_ |
| Screen Recording | _TBD_            | _TBD_      | _TBD_             | _same_                                                  |

**Windows friction (observed):** No permission dialogs for hooks, `active-win`, or `desktopCapturer` in manual testing. **Build friction:** `electron-rebuild` for `uiohook-napi` needs Python + MSVC **Desktop development with C++**; `active-win` does not need rebuild on Windows.

### 7.5 Windows sample log line

```json
{
  "event_type": "CLICK",
  "timestamp": 1783891023407,
  "foreground_app": "Microsoft Edge",
  "window_title": "Build cross-platform desktop apps... | Electron ...",
  "screenshot_ref": "output/screenshots/1783891023408-5ovwza.png",
  "x": 3221,
  "y": 923,
  "button": 1
}
```

Automated smoke: `cd spikes/electron-capture-poc && bash scripts/smoke-test-windows.sh`

### 7.6 Design assumptions from §2-§4 - confirmed / refuted

| Assumption (H09AAPPLE-69)               | Windows                           | macOS   |
| --------------------------------------- | --------------------------------- | ------- |
| Global hooks from Electron main process | Confirmed                         | Pending |
| Foreground app at event time            | Confirmed                         | Pending |
| Full-screen capture at event time       | Confirmed (thumbnail)             | Pending |
| Layered a11y + OCR per click            | **Not tested** (out of scope -70) | -       |
| 500ms screenshot throttle carries over  | Confirmed                         | Pending |

### 7.7 Effort estimate - capture-half replacement (`apps/extension` → desktop)

Separate from OCR and overlay playback spikes. Rough team-days for **Module 1 capture only**:

| Work item                                           | Est. (days) | Depends on    |
| --------------------------------------------------- | ----------- | ------------- |
| Electron app shell + tray stub (H09AAPPLE-72)       | 3-5         | -             |
| Port hook pipeline (uiohook → normalized events)    | 2-3         | -70 confirmed |
| Integrate active-win + permission UX (macOS)        | 2-4         | §7.4 Mac run  |
| Screenshot pipeline (native res, storage, throttle) | 3-5         | -70 confirmed |
| Session buffer + parity with extension event shape  | 2-3         | H09AAPPLE-71  |
| Windows installer + code signing                    | 3-5         | -72           |
| macOS notarization + permission onboarding copy     | 2-4         | §7.4          |
| QA matrix (Win/Mac x 3-5 pilot apps)                | 3-5         | all above     |
| **Subtotal (capture half only)**                    | **20-34**   |               |

### 7.8 Next steps

1. **macOS manual run** - `npm start`, screenshot every permission dialog, fill §7.4.
2. Flip macOS rows in §7.1-7.3 to Confirmed or Refuted.
3. If macOS hooks fail silently, update §2 / §4.3 to match reality.
4. Share prototype + this section with team before Sprint 3 scope lock.
