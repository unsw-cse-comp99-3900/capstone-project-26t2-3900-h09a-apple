# New-hire walkthrough observation protocol (H09AAPPLE-55)

How to run the company observation that feeds the Sprint 2 market test report.

Do not invent session notes. Fill the capture sheet only during or right after
the live run.

---

## Goal

Watch one real new hire (or a client-sourced proxy who matches that role)
complete the chosen workflow using the walkthrough, **without coaching from the
team**. Capture profile, structured feedback, and an NPS (or equivalent) score.

---

## Workflow under test

| Field                                     | Value                                                                                                             |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Primary path                              | Browser walkthrough (Chrome extension player, H09AAPPLE-28 / H09AAPPLE-29)                                        |
| Scenario                                  | Competitive Research agent build on Claude.ai (Track B)                                                           |
| Scenario source                           | `docs/demo/agent-building-workflows.md` (Track B)                                                                 |
| Why this path                             | Demoable without waiting on desktop walkthrough (H09AAPPLE-78). Matches Sprint 2 "walkthrough exists" dependency. |
| If client locked a different -51 workflow | Swap the scenario title below; keep the same unaided rules and capture sheet.                                     |

Track A (Outlook Desktop -> Claude) is out of scope for this observation until
desktop playback is ready on the observation machine.

---

## Roles

| Role        | Job                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------- |
| Facilitator | Sets up accounts/SOP link, starts recording consent if needed, stays quiet during the run |
| Observer    | Takes notes on the capture sheet; does not help with clicks or answers                    |
| Participant | Completes the walkthrough alone                                                           |

One person may be both facilitator and observer if the group is small. They
still must not help mid-run.

---

## Before the session (checklist)

1. Confirm participant is a real new hire at a real company, or a named proxy
   introduced by the client. Write which one on the sheet.
2. Publish or reuse one SOP that matches Track B (or the locked -51 workflow).
3. Verify Start Walkthrough works on the machine the participant will use.
4. Open this protocol + a blank capture sheet (section below or a copy).
5. Tell the participant: we are testing the product, not them; they can stop
   anytime; we will not jump in unless they are stuck for safety reasons
   (account lockout, crash).
6. Get verbal OK to take notes. If you record screen/audio, get explicit OK and
   keep files out of git.

---

## During the session (unaided rules)

1. Participant starts the walkthrough and works through the steps alone.
2. Observer may answer only: "we cannot help on the task itself" / logistics
   (login URL, which browser).
3. If the participant asks "what should I click?", do not answer. Note the ask
   as friction.
4. Hard stop only for: crash, auth failure that blocks everything, or the
   participant asking to end.
5. Time box: aim for one continuous run (about 20-40 minutes). If they finish
   early, still run the feedback questions.

---

## After the session (feedback script)

Ask in this order. Write answers in the participant's words when you can.

1. What were you trying to finish today?
2. Where did you hesitate or get lost?
3. What felt clear?
4. Would you use this again in your first 30 days on the job? Why / why not?
5. NPS (0-10): "How likely are you to recommend this walkthrough to another new
   hire at your company?"
6. Anything we should change before showing this to another company?

Optional pricing probe (do not conflate with the painted-door tally):

7. After they see or recall the four-tier page (Free / Solo / Team / Business),
   ask which tier they would pick for themselves. Note Free vs paid. This is
   qualitative only; the quantitative signal stays in
   `docs/market-test/pricing-painted-door.md`.

---

## Capture sheet (copy per participant)

### Participant profile

| Field                              | Value |
| ---------------------------------- | ----- |
| Date (actual, ISO)                 |       |
| Company                            |       |
| Role / title                       |       |
| Tenure (e.g. week 1, month 2)      |       |
| Real new hire or client proxy?     |       |
| Prior Claude / SOP tool experience |       |
| Machine / browser                  |       |

### Run outcome

| Field                             | Value |
| --------------------------------- | ----- |
| Workflow / SOP name               |       |
| Walkthrough started? (Y/N)        |       |
| Finished without team help? (Y/N) |       |
| Steps completed / total (approx.) |       |
| Abandoned? If yes, at which step  |       |
| Hard stop reason (if any)         |       |

### Friction log (add rows as needed)

| Time (approx.) | Step / screen | What happened | Severity (low/med/high) |
| -------------- | ------------- | ------------- | ----------------------- |
|                |               |               |                         |

### Feedback (short quotes OK)

| Question                                   | Notes |
| ------------------------------------------ | ----- |
| Trying to finish                           |       |
| Hesitation / lost                          |       |
| Felt clear                                 |       |
| Use again in first 30 days?                |       |
| NPS 0-10                                   |       |
| NPS reason (optional)                      |       |
| Change requests                            |       |
| Pricing tier they would pick (qualitative) |       |

### Observer meta

| Field                           | Value |
| ------------------------------- | ----- |
| Facilitator                     |       |
| Observer                        |       |
| Screen/audio recorded? (Y/N)    |       |
| Files stored where (not in git) |       |

---

## What counts as "done" for the observation AC

- One completed capture sheet for a real new hire or named client proxy.
- Unaided run attempted (finish preferred; honest abandon still counts if they
  started and we logged where it broke).
- NPS (or the 0-10 question above) filled in.
- Sheet data copied into `docs/market-test/sprint-2-report.md` (no fake quotes).

---

## Explicitly not doing

- Coaching the participant through clicks
- Swapping in a workflow we never prepared
- Claiming statistical significance from n=1
- Putting PII or raw recordings into the repo
- Backdating the session into Week 6
