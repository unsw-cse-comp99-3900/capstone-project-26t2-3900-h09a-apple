# Sprint 2 market test report (H09AAPPLE-55)

One market test report for Sprint 2, per the brief. Combines:

1. New-hire walkthrough observation (protocol in `observation-protocol.md`)
2. Pricing painted-door signal (source of truth: `pricing-painted-door.md`)

Feeds the Week 10 commercial pitch. Do not treat this file as a substitute for
filling the observation capture sheet or the pricing results table.

---

## 1. Schedule (actual vs brief)

| Field                    | Value                                                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Brief target             | Company observation of a new hire using the walkthrough at end of Week 6; Sprint 2 market test report            |
| Sprint 2 closed          | 2026-07-12                                                                                                       |
| Course note              | Week 6 is a flexible week in the timetable, so work that lands in Week 7 is still on the intended course cadence |
| Report drafted           | 2026-07-21 (Week 7)                                                                                              |
| Observation run (actual) | TBD - fill ISO date when the session happens; do not backdate to Week 6                                          |
| Pricing run (actual)     | TBD - copy from `pricing-painted-door.md` results log when sharing ends                                          |

**Honest read:** the brief named Week 6. This report is written in Week 7. That
is acceptable because Week 6 is flexible, not because we pretend the work ran
earlier. Sprint 2's calendar close (2026-07-12) is already past; say so when
someone asks "was this inside Sprint 2's dated window?" Answer: no for the
dated sprint close; yes for the flexible Week 6 / Week 7 course slot.

---

## 2. What we tested

| Signal                               | Method                               | Dependency                                                                         |
| ------------------------------------ | ------------------------------------ | ---------------------------------------------------------------------------------- |
| Walkthrough usability for a new hire | Live unaided observation             | H09AAPPLE-51 workflow choice; walkthrough demoable via H09AAPPLE-28 / H09AAPPLE-29 |
| Willingness to pay (directional)     | Painted Door, four tiers, no charges | H09AAPPLE-54                                                                       |

Observation protocol: `docs/market-test/observation-protocol.md`.

Pricing method and tier table: `docs/market-test/pricing-painted-door.md`
(do not duplicate numbers here; quote the results log after the run).

### Workflow used for observation

| Field                         | Value                                                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Path                          | Browser extension walkthrough                                                                                         |
| Scenario                      | Track B - Competitive Research on Claude.ai                                                                           |
| Detail                        | `docs/demo/agent-building-workflows.md`                                                                               |
| Why not Track A for this test | Desktop Outlook path needs desktop walkthrough readiness; not required to satisfy Sprint 2's "walkthrough exists" bar |

If H09AAPPLE-51 locked a different workflow with the client, replace the
scenario row above and keep the same unaided method.

---

## 3. Observation results

**Status as of 2026-07-21:** protocol ready; live session not yet pasted into
this report. Leave cells blank until a real capture sheet exists. Do not invent
quotes, NPS, or "finished successfully" claims.

### Participant profile

| Field                          | Value |
| ------------------------------ | ----- |
| Date (actual, ISO)             |       |
| Company                        |       |
| Role / title                   |       |
| Tenure                         |       |
| Real new hire or client proxy? |       |
| Prior tool experience          |       |

### Run outcome

| Field                             | Value |
| --------------------------------- | ----- |
| Finished unaided? (Y/N)           |       |
| Steps completed / total (approx.) |       |
| Abandoned at                      |       |
| Top friction (1-3 bullets)        |       |

### Feedback summary

| Field                              | Value |
| ---------------------------------- | ----- |
| What was clear                     |       |
| What was confusing                 |       |
| Use again in first 30 days?        |       |
| NPS (0-10)                         |       |
| NPS / score meaning in their words |       |
| Change requests                    |       |

Raw sheet stays with the observer (not in git if it has PII). This section is
the shareable summary only.

---

## 4. Pricing signal (H09AAPPLE-54)

Source of truth: `docs/market-test/pricing-painted-door.md`.

### Assumptions you must state when citing this number

1. The page shows **Free + Solo + Team + Business**. The signal answers
   "would someone still click a paid CTA when Free is available?", not
   "would they click if every tier were paid."
2. Approx. Subscribe conversion = (Solo + Team Subscribe clicks) /
   **known share reach** (manual headcount of people you sent the link to).
   It is **not** page-view CTR. Do not present it as a precise click-through
   rate.
3. Contact us (Business) is a separate line. Free choices are context only.
4. Directional only. No claim of statistical significance (out of scope for
   this card).

### Tallies (copy from -54 results log after the run)

| Field                        | Value                       |
| ---------------------------- | --------------------------- |
| Public URL                   |                             |
| Run start / end (actual)     |                             |
| Known share reach            |                             |
| Subscribe Solo               |                             |
| Subscribe Team               |                             |
| Approx. Subscribe conversion |                             |
| Contact us (Business)        |                             |
| Free choices                 |                             |
| Denominator note             | Share reach, not page views |

Until those cells are filled in -54, write "pending run" here rather than a
made-up rate.

### Qualitative pricing note from observation (optional)

If the participant answered the optional tier question in the protocol, one
line here. Keep it separate from the painted-door tally.

---

## 5. Scope decision

Fill after observation + pricing tallies exist. Draft stance below is
**provisional** (product direction from shipped walkthrough + pricing design),
not a claim that the live observation already confirmed it.

| Decision                                                | Provisional stance (2026-07-21)                                                                                                     | Confirm after live data |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Primary walkthrough surface for near-term company demos | Keep shipping the **browser** walkthrough path; treat desktop Outlook track as the next proof, not the Sprint 2 observation blocker | Y/N after session       |
| Workflow focus for pitch                                | Lead with a browser-completable agent-build walkthrough (Track B style) until desktop Track A is demo-stable                        | Y/N after session       |
| Pricing shape to show externally                        | Keep **four tiers (Free + three paid)**; do not present an all-paid three-tier story as if that were what we tested                 | Y/N after -54 tallies   |
| What we will not expand for Week 10                     | No second unrelated workflow for the pitch; no fake precision on pricing CTR                                                        | -                       |

**Final scope decision (one paragraph, fill after data):**

> TBD. Replace this paragraph with: what we keep, what we cut, and which
> pricing story we will tell in the Week 10 deck, tied to the observation and
> the approximate Subscribe / share-reach figure.

---

## 6. Limits (say these out loud)

- Observation n is small (AC is one real new hire / proxy). Qualitative.
- Pricing rate is approximate and hypothesis-bound (Free on page; share-reach
  denominator).
- Report date is Week 7; Week 6 was flexible; Sprint 2 dated close is past.
- Desktop multi-app walkthrough quality is a separate engineering line; this
  report does not claim that path was observed unless the capture sheet says so.

---

## 7. Test coverage

This card is documentation and a live observation. **No new automated tests**
were added for H09AAPPLE-55.

Related coverage that already exists elsewhere (not owned by this card):

| Area                                      | Coverage                                                                                | Notes                                                             |
| ----------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Extension walkthrough player              | Existing unit / source checks under `apps/extension` (H09AAPPLE-28 / H09AAPPLE-29 line) | Needed so the observation path is real                            |
| Desktop walkthrough                       | Unit tests under `apps/desktop/src/main/walkthrough/` (H09AAPPLE-78)                    | Not required for this Sprint 2 observation path                   |
| Painted-door page (`pricing-experiment/`) | No automated test suite                                                                 | Click log is browser `localStorage` + CSV export; tally is manual |

If someone asks "what is the test coverage for -55?", answer: none required;
pass criteria are the filled observation sheet, the pricing caveats, and this
report.

---

## 8. Jira paste (H09AAPPLE-55)

```
H09AAPPLE-55 Sprint 2 market test report

Sources:
- docs/market-test/sprint-2-report.md (this report)
- docs/market-test/observation-protocol.md
- docs/market-test/pricing-painted-door.md (pricing tallies + Free-on-page hypothesis)

Schedule: brief said Week 6; Week 6 is flexible week; report work in Week 7
(2026-07-21). Do not backdate observation or pricing into Week 6. Sprint 2
dated close 2026-07-12 is past; say so if asked.

Observation: unaided new hire / proxy on browser walkthrough (Track B unless
-51 locked otherwise). Capture profile, friction, NPS.

Pricing: quote approx Subscribe / known share reach only; state Free-on-page
assumption; not page-view CTR.

Scope decision: fill final paragraph after live data. Provisional stance
documented in the report table.

Test coverage: docs/observation card; no new automated tests for -55.
```
