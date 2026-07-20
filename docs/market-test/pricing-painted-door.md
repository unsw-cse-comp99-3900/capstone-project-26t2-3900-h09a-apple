# Painted Door Pricing Experiment (H09AAPPLE-54)

Source of truth for the no-code willingness-to-pay test required by the brief
("A no-code pricing experiment runs in parallel to test willingness to pay").

Jira should link here instead of duplicating tiers, run dates, or click tallies.

Feeds: **H09AAPPLE-55** (market test report).

---

## Status (honest schedule)

| Field              | Value                                                                 |
| ------------------ | --------------------------------------------------------------------- |
| Brief target       | Sprint 2 / Week 6 (parallel with other market tests)                  |
| Sprint 2 closed    | 2026-07-12                                                            |
| Week 6             | Passed without this card or H09AAPPLE-55 starting                     |
| This revision      | 2026-07-21                                                            |
| Execution mode     | **Late catch-up** - run now; do not backdate or imply on-schedule run |
| Engineering needed | None (Option A). Does not block or wait on -77 / -78 / -36 / -79      |

Record the real **run start date** in the results table below when sharing begins.

---

## Method

Painted Door (lean validation) with a **realistic four-tier catalog** (Free + paid):

1. Present Free + Solo + Team + Business on one page (what users would actually see).
2. Paid CTAs record intent. **No payment is taken.**
3. User lands on an honest "coming soon / we'll be in touch" page.
4. Metrics below feed H09AAPPLE-55.

**Hypothesis note for H09AAPPLE-55 (do not blur):** with Free on the page, this
experiment measures willingness to pay **when a free option is available**, not a
pure paid-only door. That is closer to real product structure; it is a different
question than "would they click Subscribe if every tier were paid."

This is Option A only (standalone page). Option B (in-product modal) is out of
scope here.

---

## Evidence and rationale (fact vs judgment)

This section is what -55 should cite when asking "why Free?" and "why these
prices?". Labels:

- **Research fact** = competitor pages checked by the team (stated as of **2026-07**).
  Not independently re-scraped in this file revision; if prices move, update the
  table and the check date.
- **Judgment** = WorkTrace design choice. Not a surveyed "industry standard."

### Why add a Free tier (research fact)

| Product                                    | Free-tier pattern (2026-07 team check)                                                          | Source                                   |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Scribe                                     | Free can create unlimited guides; no desktop capture; no custom branding; collaboration limited | https://scribe.com/pricing               |
| Tango                                      | $0/mo; up to 10 users; 5 shared workflows                                                       | https://tango.ai/pricing                 |
| Whale                                      | Free positioned for exploring quick documentation; basic create features                        | https://usewhale.io/pricing              |
| Clicky (Windows / macOS / Chrome variants) | Free tier until usage caps (e.g. daily AI calls), then upgrade                                  | clicky.foo, heyclicky.com, clicky-ai.com |

**Clicky note (background only, not a WorkTrace pricing anchor):** Clicky's
Explorer/Pro/Team daily AI-call quotas are consumer-assistant metering. Do
**not** copy recurring usage quotas into WorkTrace Free/Solo/Team. WorkTrace is
B2B collaboration; tiers are **seats + feature limits** (same family as
Scribe/Tango). Business stays Contact us - no need to stack a second quota axis
on Free/Solo/Team.

**Conclusion from that check:** every comparable tool in the set ships a Free
layer as default product structure. Free lowers try cost; paid pages are for
people who already want more seats/features. An all-paid three-tier page would
not match that market structure.

### WorkTrace Free limits (judgment)

Pattern borrowed from Scribe/Tango-style limits (constrain collaboration +
advanced capture; do not gut the core loop):

| Limit                      | Value                                       |
| -------------------------- | ------------------------------------------- |
| Seats                      | 1                                           |
| Capture                    | Browser extension only (no desktop capture) |
| Published SOPs             | Up to 3                                     |
| Team shared library        | No                                          |
| Review-before-publish flow | No                                          |

**Why these limits (judgment):** one person can finish record -> SOP -> self
walkthrough; not enough for real team use; desktop capture is a clear upgrade
reason. CTA: **Start with Free** (`action=choose_free`), not Subscribe.

### Competitor paid bands used as reference (research fact)

| Reference                                           | Public band (2026-07 team check)            | Source                     |
| --------------------------------------------------- | ------------------------------------------- | -------------------------- |
| Scribe Team                                         | about $17/seat/mo, min 5 seats              | https://scribe.com/pricing |
| Tango Team                                          | about $15-20/seat/mo, 3+ seats              | https://tango.ai/pricing   |
| Scribe / Tango Personal                             | about $22-29/seat/mo                        | same sources as above      |
| Top tier (Enterprise / Business) across these tools | Contact us / custom; no fixed public number | same sources as above      |

### WorkTrace paid prices on the painted door (judgment)

Early penetration: price below mature competitors while WorkTrace is early and
light on case studies. **About 20-30% under** the bands above is a strategy
choice, not a researched rule. Adjust later if the team disagrees on depth.

| Tier     | Painted-door price                                    | How it relates to the research table                                                                              |
| -------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Solo     | $19 / seat / mo                                       | Under Personal band (~$22-25 low end); roughly ~20% off as early trial pricing                                    |
| Team     | $12 / seat / mo, **min 5 seats** (from $60 / mo)      | Under Team band (~$15-17 low end); page must show seat minimum so it is not read as cheaper-than-Solo single-seat |
| Business | Contact us / Early access pricing (no fixed public $) | Matches competitor top-tier pattern; more honest than inventing a discounted fixed number                         |

---

## Offer (four tiers) - page copy summary

| Tier id    | Name     | Price (USD)                                  | Who it is for                             | CTA               | Log `action`  |
| ---------- | -------- | -------------------------------------------- | ----------------------------------------- | ----------------- | ------------- |
| `free`     | Free     | $0                                           | Solo browser try (limits above)           | Start with Free   | `choose_free` |
| `solo`     | Solo     | $19 / seat / mo                              | Individual with desktop + browser capture | Subscribe to Solo | `subscribe`   |
| `team`     | Team     | $12 / seat / mo, min 5 seats (from $60 / mo) | Small team shared library + review        | Subscribe to Team | `subscribe`   |
| `business` | Business | Early access / Contact us                    | Multi-team org, priority help             | Contact us        | `contact`     |

Highlighted default on the page: **Team**.

---

## Core metrics (for H09AAPPLE-55)

### Approximate conversion rate (not precise page CTR)

`localStorage` only records **clicks in browsers that opened the page**. It does
**not** record how many people saw the URL. Without host analytics there is no
true unique-visitor denominator.

For this experiment we **do not** add Netlify/Cloudflare analytics or extra
tracking code. H09AAPPLE-55 treats formal statistical significance as out of
scope (qualitative + directional signal is enough). At tens-to-low-hundreds of
people, host analytics would not buy much credibility over a manual share count.

**Denomimator (manual):** people you knowingly shared the link with (e.g. "sent
to 40 people via class group / WeChat / email"). Sum across channels.

**Numerator (Subscribe):** Solo + Team clicks with `action=subscribe` (from CSV
exports and/or hallway tallies).

```
Approx. Subscribe conversion =
  Subscribe clicks (Solo + Team)
  / Known share reach (people the link was sent to)
  x 100%
```

Example: link sent to 40 people, 5 Subscribe clicks => **~12.5% approximate
conversion**. Report it as an estimate, not page-view CTR.

Rules:

- Label the metric **approximate conversion (share-reach denominator)**, not
  precise CTR.
- **Do not** invent unique visitors.
- **Do not** merge Contact us into the Subscribe numerator.
- Free choosers stay in the share-reach world (they are part of the 40); do not
  shrink the denominator by excluding them.
- In -55, state clearly: denominator = known share count, **not** measured page
  views.

### Contact us (separate row)

- Count Business **Contact us** clicks (`action=contact`) on their own line.
- Real paid intent for B2B top tier, but different strength than Subscribe.
- Optional: Contact us / share reach as a second approximate rate; never merge
  into the Subscribe numerator.

### Free choices (context, not Subscribe numerator)

- Count **Start with Free** (`action=choose_free`) for funnel context only.

### Report layout (required)

| Row                          | Definition                                               |
| ---------------------------- | -------------------------------------------------------- |
| Known share reach            | Manual count of people the link was sent to (by channel) |
| Subscribe clicks (Solo)      | `action=subscribe`, tier=solo                            |
| Subscribe clicks (Team)      | `action=subscribe`, tier=team                            |
| Approx. Subscribe conversion | (Solo+Team subscribe) / known share reach                |
| Contact us clicks            | `action=contact`, tier=business (own line)               |
| Free choices                 | `action=choose_free`                                     |
| Denominator caveat           | Share reach, not page analytics                          |

---

## Build (Option A, in this repo)

| File                                                   | Role                           |
| ------------------------------------------------------ | ------------------------------ |
| `docs/market-test/pricing-experiment/index.html`       | Four-tier page + CTAs          |
| `docs/market-test/pricing-experiment/coming-soon.html` | Honest painted-door landing    |
| `docs/market-test/pricing-experiment/click-log.js`     | Local click store + CSV export |

### How to host today (pick one)

1. **Netlify Drop / Cloudflare Pages**: drag the `pricing-experiment/` folder; share the public URL.
2. **Open locally** for hallway tests: open `index.html` in a browser (click log stays in that browser).
3. **Optional Framer/Webflow rebuild**: copy the same four tiers and CTAs; keep this doc as source of truth.

### How clicks are recorded

- Each CTA appends `{ tier, action, ts, href, ua }` to `localStorage` key
  `worktrace-painted-door-clicks`.
- Redirect: `coming-soon.html?tier=<id>&action=<subscribe|contact|choose_free>`.
- Footer **Export click log (CSV)** downloads this browser's events.
- **Share reach is manual** (how many people you sent the link to). No host
  analytics required for this card.
- Optional later: UTM or host analytics only if someone wants a second check;
  not needed for AC or for -55's directional bar.

Do not process payments. Do not paste live Stripe keys into these files.

---

## Run checklist

1. Host `pricing-experiment/` and copy the public base URL into the results table.
2. Set **Run start (actual)** to today's date (ISO).
3. Share the link; **write down channel + headcount** as you go (this is the
   denominator).
4. Do not imply the experiment ran in Week 6.
5. Export CSV from machines used in hallway tests; add any remote click notes;
   tally Subscribe and Contact us **separately**.
6. Compute approx. Subscribe conversion = Subscribe / known share reach.
7. Hand tallies + denominator caveat + hypothesis note to H09AAPPLE-55.

---

## Results log (fill during the run)

| Field                                                  | Value                       |
| ------------------------------------------------------ | --------------------------- |
| Public URL                                             |                             |
| Run start (actual, ISO date)                           |                             |
| Run end (actual, ISO date)                             |                             |
| Channels + headcount (e.g. class group 25, email 15)   |                             |
| Known share reach (sum)                                |                             |
| Subscribe clicks Solo                                  |                             |
| Subscribe clicks Team                                  |                             |
| Approx. Subscribe conversion (Solo+Team / share reach) |                             |
| Contact us clicks (Business)                           |                             |
| Free choices                                           |                             |
| Denominator note                                       | Share reach, not page views |
| Notes / qualitative comments                           |                             |

### Per-response scratch (optional)

| Timestamp (ISO) | Channel | Tier | Action | Notes |
| --------------- | ------- | ---- | ------ | ----- |
|                 |         |      |        |       |

---

## What H09AAPPLE-55 should quote

- Method: Painted Door; no real billing; **Free present on page**.
- Explicit hypothesis: WTP **with Free available** (not paid-only door).
- **Evidence section above**: competitor Free table + paid bands (research fact)
  vs WorkTrace Free limits + penetration prices (judgment).
- Offer table (four tiers).
- Actual run window (late vs Week 6 target).
- **Approx. Subscribe conversion** = (Solo+Team Subscribe) / **known share
  reach** (manual). Not page-view CTR; say so in the report.
- Contact us as a **separate** line (not merged into Subscribe numerator).
- Free choices as context.
- Caveats: late catch-up; directional only; no claim of statistical
  significance (aligned with -55 out of scope).

---

## Explicitly not doing

- Real Stripe charges or subscription backend
- In-product pricing modal (Option B)
- Waiting on desktop / seed / engineering cards
- Backdating the run into Week 6
- Merging Contact us into Subscribe conversion
- Inflating rates by excluding Free choosers from share reach
- Requiring host-level analytics / precise unique-visitor CTR for this card

---

## Jira paste (H09AAPPLE-54)

```
H09AAPPLE-54 Painted Door pricing experiment (Option A)

Source of truth: docs/market-test/pricing-painted-door.md
Static page: docs/market-test/pricing-experiment/

Tiers: Free | Solo $19/seat/mo | Team $12/seat/mo (min 5) | Business Contact us
Subscribe (Solo/Team) and Contact us logged separately; Free = Start with Free.
Approx. conversion = Subscribe clicks / known share reach (manual headcount).
No host analytics required; report as estimate, not page-view CTR. No payment.

Schedule: late catch-up after Week 6 / Sprint 2; record actual run dates; do not backdate.
Hypothesis: WTP with Free on page (call out in H09AAPPLE-55).
Feeds H09AAPPLE-55. Zero engineering dependency.
```
