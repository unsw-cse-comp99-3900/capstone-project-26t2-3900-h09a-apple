# WorkTrace AI - Web Design Reference

This is the design token reference for `apps/web`. It documents what is
**already implemented** across the app (extracted from `globals.css`,
`login/auth.module.css`, `sop/[id]/sop-viewer.module.css`, and
`session/review/session-review.module.css`) so new pages reuse the same
values instead of picking new ones.

This is not a Jira ticket and does not define scope or acceptance criteria.
See the relevant Jira card for what to build; see this file for how it
should look once built.

## 1. Typography

- **Font**: [Inter](https://fonts.google.com/specimen/Inter), loaded via
  Google Fonts in `login/auth.module.css`. Weights in use: 400, 500, 600,
  700, 800.
- **Fallback stack**: `Inter, system-ui, sans-serif`.
- Base page font (outside styled panels) falls back to `system-ui,
sans-serif` per `globals.css`. Pages that do not opt into the Inter stack
  should still add it for consistency.

**Size scale in use** (do not introduce new sizes without a reason):

| Use                         | Size                                                           |
| --------------------------- | -------------------------------------------------------------- |
| Page hero `h1`              | `clamp(34px, 5vw, 54px)`, weight 800, letter-spacing `-0.04em` |
| Panel heading (`h2`)        | `28px`, weight 800                                             |
| Card heading                | `24px`                                                         |
| Body / instruction text     | `16px`, line-height `1.65`                                     |
| Secondary/meta text         | `13px` to `14px`                                               |
| Eyebrow / label (uppercase) | `12px`, weight 800, letter-spacing `0.14em`, uppercase         |
| Badge / pill text           | `12px` to `13px`, weight 700 to 800                            |

## 2. Colour palette

### Brand gradient (primary actions, icon chips, step numbers)

```
linear-gradient(135deg, #756eff, #6882e8)
```

Used for: submit buttons, event/step icon chips, the logo mark on auth
pages. **Canonical values are `#756eff` to `#6882e8`.**

> Known inconsistency to fix: `session-review.module.css` `.submitButton`
> currently uses `#706ee8` to `#647ee1`, a slightly different pair. Update it
> to the canonical `#756eff` to `#6882e8` next time that file is touched.

### Secondary accent (teal, used sparingly for a second gradient stop)

```
#45c7a7
```

Used in: auth brand-panel radial highlights, screenshot-placeholder icon
gradient (`#756eff` to `#45c7a7`).

### Text colours

| Token          | Hex                               | Use                              |
| -------------- | --------------------------------- | -------------------------------- |
| Primary text   | `#17213d`                         | headings, body copy, card values |
| Secondary text | `#66708f` / `#5f6b8f`             | lead paragraphs, descriptions    |
| Muted text     | `#75809d` / `#69748f` / `#7a849e` | captions, timestamps, labels     |
| Field label    | `#334065`                         | form field labels                |
| Link           | `#5b63d9`                         | footer/inline links              |

### Surface & border

| Token                    | Hex                                                 | Use                     |
| ------------------------ | --------------------------------------------------- | ----------------------- |
| Card background          | `#ffffff`                                           | default card surface    |
| Soft background gradient | `linear-gradient(135deg, #ffffff 0%, #f4f6ff 100%)` | hero panels             |
| Border (default)         | `#e2e6f6` / `#dfe4f2` / `#e5e8f4`                   | card borders            |
| Border (accent-tinted)   | `#dfe4ff` / `#cbd5ff` / `#d7ddf5`                   | hero/pill/input borders |
| Pill background          | `#f5f6ff` / `#f5f7fc`                               | status pills, tag chips |

### Dark brand panel (login/register left panel)

```
linear-gradient(145deg, #14102f 0%, #2a2468 42%, #1f3f8a 100%)
```

with radial highlights:

```
radial-gradient(circle at 18% 22%, rgb(117 110 255 / 34%), transparent 42%)
radial-gradient(circle at 82% 78%, rgb(69 199 167 / 18%), transparent 36%)
```

Panel text: `#f5f7ff` (headings), `rgb(226 230 255 / 88%)` (lead copy),
`rgb(199 204 255 / 92%)` (eyebrow on dark surfaces).

### Status colours

| State                   | Text                  | Background | Border    |
| ----------------------- | --------------------- | ---------- | --------- |
| Loading / info          | `#4b58c5`             | `#f5f6ff`  | `#cbd5ff` |
| Success / loaded        | `#27785f`             | `#f1fbf7`  | `#bfe3d5` |
| Error                   | `#983452` / `#b4234a` | `#fff4f7`  | `#f1bfd0` |
| Warning callout         | `#744f10`             | `#fff8e6`  | `#f0cf84` |
| Branch/decision callout | `#4a3aa3`             | `#f6f3ff`  | `#d6ccff` |

Disabled buttons: text `#a4abc0`, background `#eceef5`, no shadow.

## 3. Spacing & radius

- **Page padding**: `48px 24px` desktop, `24px 14px` mobile (`<640px` /
  `<760px`).
- **Card radius**: `20px` to `28px` for top-level cards/hero panels, `14px`
  to `18px` for nested elements (inputs, timeline items, icon chips), `999px`
  for pills/badges.
- **Icon chip size**: `42px` to `52px` square, radius `14px` to `18px`,
  gradient fill, white icon/number centred. Auth feature chips use `34px`
  square at `9px` radius on the dark panel.
- **Gap scale**: `8px`, `12px`, `16px`, `18px`, `24px`. Pick from this set
  rather than arbitrary values.

## 4. Shadows

```
/* card elevation */
box-shadow: 0 14px 35px rgb(85 94 145 / 8%);   /* small card */
box-shadow: 0 18px 48px rgb(85 94 145 / 10%);  /* panel */
box-shadow: 0 24px 60px rgb(75 86 145 / 12%);  /* hero */

/* brand-coloured elevation (buttons, icon chips) */
box-shadow: 0 10px 22px rgb(104 125 230 / 22%);
box-shadow: 0 12px 28px rgb(95 105 220 / 24%);
```

## 5. Component patterns

- **Icon/number chip**: square, gradient-filled, radius `14px` to `18px`,
  white glyph or number, used for step numbers and event-type icons.
- **Status pill**: `999px` radius, `8px` to `14px` horizontal padding,
  coloured per the status table above.
- **Split-panel auth layout** (`login/auth.module.css`,
  `components/auth-brand-panel.tsx`): dark gradient brand panel (left, about
  50% to 55% width) plus white form panel (right). Collapses to a single
  column under `768px`.
- **Callout box**: used for warnings/branches inside SOP steps. Coloured
  background plus matching border, no shadow. Distinct from cards (white with
  a shadow, no colour tint).

## 6. Auth panel components (H09AAPPLE-44)

Implemented on `/login` and `/register`. CSS and inline SVG only; no new
libraries. Both pages share the same split-panel layout, brand copy, form
card surface, and security line. SSO provider buttons are intentionally
omitted until H09AAPPLE-62.

| Component                   | Spec                                                                                                                                                                      | Source                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| **Logo mark**               | `42px` square, radius `11px`, brand gradient fill (`#756eff` to `#6882e8`), white workflow line-icon centred. Sits left of the "WorkTrace AI" wordmark.                   | `auth-brand-panel.tsx`, `.logoMark`          |
| **Eyebrow badge (pill)**    | Above the brand headline. Pill shape (`999px` radius), translucent violet fill tuned for the dark panel, sparkle icon plus label (`12px`, weight 600).                    | `.eyebrowBadge`                              |
| **Feature list icon chips** | Each bullet uses a `34px` square chip on the dark panel with title (`14px`) and description (`13px`).                                                                     | `.featureItem`, `.featureChip`               |
| **Form card surface**       | White card on the right panel: `20px` radius, `#e2e6f6` border, `0 18px 48px rgb(85 94 145 / 10%)` shadow, `28px` padding. Wraps heading, form, links, and security line. | `.formCardSurface`, `auth-form-card.tsx`     |
| **Input icon prefixes**     | Email and password fields show a `17px` line-icon inside the input, left-aligned at `13px`, colour `#75809d`. Input padding-left `40px`.                                  | `.inputWrap`, `.inputIcon`, `.inputWithIcon` |
| **Security line**           | Inside the form card: `Enterprise security · PII auto-masked · Tenant-isolated` (`12.5px`, muted text, top border).                                                       | `.securityLine`                              |
| **Form-panel footer**       | Below the card: `© 2026 WorkTrace AI · Privacy · Terms · Status`. Links use the muted-link colour (`#69748f`, hover `#5b63d9`).                                           | `auth-form-footer.tsx`, `.formMetaFooter`    |

Icons follow the stroke style used elsewhere in the app: `stroke-width 1.9`,
round linecap/linejoin (see `session-review.module.css` `.eventIcon svg`).

## 7. Explicitly out of the current palette

Do not add without a product decision first:

- SSO provider buttons (Google, etc.). Tracked separately in H09AAPPLE-62,
  not yet built.
- Client logos, testimonials, or compliance badges (SOC 2, GDPR). Not
  applicable to this product; do not add placeholder or fabricated versions.
- A second brand colour outside the violet to blue to teal range above.

## 8. Where this applies next

Cards that will introduce new screens and should draw from this file rather
than inventing new tokens: H09AAPPLE-57 (app shell / SOP review actions),
H09AAPPLE-38 / H09AAPPLE-39 (Variance Dashboard), H09AAPPLE-82 (SOP Library
search, filter chips, view toggle, and Play-to-launch). Library Play uses
`apps/web/src/lib/extension-bridge.ts` (`START_WALKTHROUGH`); the Chrome
extension opens the target page and injects the guide there. Do not treat
`apps/web/src/components/floating-assistant/` as the live guide (unused;
commented out of the root layout). Extension-rendered UI (H09AAPPLE-28 /
H09AAPPLE-29 / H09AAPPLE-32 / H09AAPPLE-80 walkthrough overlay and assistant
surfaces) runs inside a third-party page and intentionally does not use this
palette wholesale. See those cards for overlay-specific styling.
