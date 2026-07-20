# Demo Agent Workflows (Sprint 3)

Source of truth for the client-facing agent-building demos that feed:

- H09AAPPLE-50 (prompt coaching panel worked examples)
- H09AAPPLE-78 (desktop guided walkthrough recording)
- H09AAPPLE-79 (client sign-off and scenario lock)

Jira cards should link here instead of duplicating full prompt text or recording scripts.

Related pattern: design detail lives in-repo (same approach as H09AAPPLE-70 pointing at `docs/spikes/electron-desktop-capture-review.md`).

---

## Status

| Track | Name                 | Primary surface                                       | Ready for Week 8?                        | Client sign-off                 |
| ----- | -------------------- | ----------------------------------------------------- | ---------------------------------------- | ------------------------------- |
| A     | Chief of Staff       | Outlook Desktop -> Claude Project Custom Instructions | No (blocked on desktop walkthrough line) | Pending Lamont on exact content |
| B     | Competitive Research | Claude.ai via browser extension                       | Yes (candidate / backup)                 | Pending Lamont on exact content |

**Deferred (not this Sprint 3 polished demo):** Notion connector / second brain, GitHub no-code, Gmail-as-PWA primary, Daily News Aggregator (overlaps Track B).

---

## Why two tracks

1. **Track A** answers the client's "Claude and Microsoft" ask in one continuous workflow and proves why desktop capture matters (native Outlook -> Claude).
2. **Track B** is a lighter browser-first path that can ship with existing extension work (H09AAPPLE-28 / H09AAPPLE-29) while the desktop line finishes.
3. Guardrail demos differ on purpose:
   - Track A: write-capable calendar / inbox actions (never auto-accept, never auto-archive).
   - Track B: research integrity (confirmed vs rumored; no paywalled scrape).

---

## Track A: Chief of Staff (flagship desktop demo)

### Platform

Outlook Desktop (calendar + inbox) -> switch to Claude (claude.ai or Claude Desktop) -> Claude Project -> Custom Instructions field.

`fieldKind=prompt` coaching (H09AAPPLE-50) activates on Custom Instructions.

### Dependencies

- H09AAPPLE-77 (desktop walkthrough / backend integration)
- H09AAPPLE-78 (desktop guided walkthrough)

Do not treat Track A as Week 8 primary until those land and Outlook Desktop is confirmed on the recording machine.

### Motivating problem (opening context)

An employee spends time every day triaging inbox priority and checking for calendar conflicts. They want Claude to draft a first-pass plan (suggestions only, never decisions).

This opening may be narrated rather than recorded as a click step.

### Recording outline (high level)

1. Outlook Desktop: show inbox / calendar context that motivates the agent (optional narration).
2. Navigate to Claude (NAVIGATION step).
3. Create or open a Claude Project.
4. Open Custom Instructions (prompt coaching target).
5. Fill Identity / Context / Steps / Output / Guardrails with the text below (coaching panel validates missing guardrails).
6. Test live: paste a sample customer or internal email as the first message; watch a draft priority plan / reply following the instructions.
7. Finish: export or save the completed prompt / project instructions.

### Five-section prompt (worked example)

**IDENTITY**

You are the Chief of Staff assistant for [name/role]. You help manage their calendar and inbox so they can focus on higher-priority work. Tone: professional, efficient, never presumptuous.

**CONTEXT**

Before acting, read: the current calendar for the day/week, and the inbox's unread messages with sender and subject.

**STEPS**

1. Scan unread emails and rank by urgency (client-facing, deadline-related, from leadership = high; newsletters/FYI = low).
2. Check the calendar for scheduling conflicts or gaps in the next 3 business days.
3. Draft a suggested priority order for the inbox.
4. Flag any meeting request that conflicts with an existing commitment, but do not move or accept anything without confirmation.

**OUTPUT**

Return:

- Priority Email List (top 3-5, one-line reason each)
- Calendar Conflicts (if any)
- Suggested Actions (as a checklist, not auto-applied)

**GUARDRAILS**

- Never accept, decline, or reschedule a calendar invite automatically; only suggest.
- Never mark an email as read or archived without the user's confirmation.
- Never surface the content of confidential or private emails beyond "1 confidential email received."

### Guardrail demo beat

Calendar and inbox actions are write-capable. During the client demo, omit a guardrail on purpose (or leave one blank) and show H09AAPPLE-50 catching it before the user "ships" the agent.

### Environment checklist

- [ ] Outlook Desktop (not OWA / browser) installed and signed in on the recording machine
- [ ] Claude Project Custom Instructions field reachable in the same continuous session
- [ ] Sample inbox / calendar data is fictional or redacted (no real customer PII)

### Sample fixtures (fill before recording)

| Fixture                              | Placeholder | Final text owner      |
| ------------------------------------ | ----------- | --------------------- |
| Sample unread subjects               | TBD         | After Lamont sign-off |
| Sample calendar conflict             | TBD         | After Lamont sign-off |
| Live test message pasted into Claude | TBD         | After Lamont sign-off |

---

## Track B: Competitive Research (lighter browser-first demo)

### Platform

Claude.ai in the browser, recorded with the existing Chrome extension (H09AAPPLE-28 / H09AAPPLE-29). Can also be re-recorded later on desktop if useful; desktop is not required for Week 8.

### Dependencies

Shipped browser capture + walkthrough stack. No hard dependency on H09AAPPLE-77 / H09AAPPLE-78.

### Motivating problem

The user wants Claude to periodically organize a competitor's public moves so they do not have to check every day.

### Recording outline (high level)

1. Open Claude.ai (or start mid-flow in a Project).
2. Open Custom Instructions (or equivalent prompt field used for coaching).
3. Fill the five-section content below.
4. Paste a competitor homepage / newsroom URL plus any notes.
5. Run once; show categorized bullets with sources and confirmed vs rumored split.
6. Finish / save.

### Five-section prompt (worked example)

**IDENTITY**

You are a competitive research analyst assistant. You help the user track a specific competitor's public moves. Tone: analytical, neutral, always cites sources.

**CONTEXT**

Before acting, read: the competitor's public website/blog/newsroom page provided by the user, and any notes the user has already gathered.

**STEPS**

1. Identify the competitor's most recent public announcements (last 30 days).
2. Categorize each into: Product, Pricing, Hiring/Org, Partnerships.
3. Note anything that looks like a meaningful shift versus prior positioning.
4. Flag anything unverified or rumor-based separately from confirmed facts.

**OUTPUT**

Return a categorized bullet list with a source link per item, plus a one-line "why this matters" note.

**GUARDRAILS**

- Never present an unverified claim as confirmed fact; separate "confirmed" vs "rumored/unverified" clearly.
- Never scrape or summarize paywalled or access-restricted content.
- Always include the source link for every claim.

### Guardrail demo beat

This is a read-oriented task. Coaching validation emphasizes research integrity (not "do not send mail"), so Track A and Track B show two different safety boundaries.

### Environment checklist

- [ ] Extension recording path verified on Claude.ai Custom Instructions
- [ ] Public competitor URL chosen (no login wall)
- [ ] Sample "notes already gathered" blurb written

---

## Explicitly not doing

| Idea                                               | Why deferred                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------ |
| Daily News Aggregator                              | Overlaps Track B (external info gather + summarize)                |
| Notion connector / second brain                    | Client candidate; not Sprint 3 flagship                            |
| Chief of Staff as a separate non-Outlook tool demo | Folded into Track A                                                |
| GitHub no-code                                     | Too technical for the non-technical persona                        |
| Gmail PWA as primary                               | Valid desktop-boundary case, but does not answer the Microsoft ask |

---

## Sign-off and handoff checklist

### Client (Lamont)

- [ ] Written, dated approval of Track A scenario and five-section text (or a named revision)
- [ ] Written, dated approval of Track B scenario and five-section text (or a named revision)
- [ ] Confirmation which track is primary for the next client-facing session

### Product / eng

- [ ] Update H09AAPPLE-50 card description to link this doc (replace generic placeholder examples)
- [ ] Confirm Outlook Desktop on the Track A recording machine
- [ ] Record Track B first if Week 8 needs a working walkthrough before desktop is ready
- [ ] Record Track A once H09AAPPLE-77 / H09AAPPLE-78 are demoable

### Doc hygiene

- Edit this file in PRs; do not paste long prompt bodies back into Jira.
- When examples change after sign-off, note the date and what changed under Changelog below.

---

## Jira paste (H09AAPPLE-79)

Keep the card short; link here for full text.

**Summary**

Lock Sprint 3 client demo workflows for agent-building: Track A Chief of Staff (Outlook Desktop -> Claude) and Track B Competitive Research (browser-first). Full scenarios, five-section prompts, and recording notes live in-repo.

**Source of truth**

`docs/demo/agent-building-workflows.md`

**Still on this card**

- Lamont dated sign-off on exact Track A/B content
- Confirm Outlook Desktop on the Track A recording machine
- Point H09AAPPLE-50 at this doc; record Track B first if Week 8 needs a fallback

**Out of scope**

Notion / GitHub no-code / Gmail-PWA primary / Daily News Aggregator (see Explicitly not doing above)

---

## Changelog

| Date       | Change                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------- |
| 2026-07-20 | Initial Sprint 3 plan: Track A Chief of Staff + Track B Competitive Research (H09AAPPLE-79) |
