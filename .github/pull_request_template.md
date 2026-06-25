<!--
PR title must follow Conventional Commits, e.g.
  feat(web): add login page
  fix(api): handle empty cors origins
  chore(devops): bump turbo to v2.4

Required sections: Summary, Linked card, Test plan.
Other sections: fill in if relevant, otherwise write N/A or delete the section.
-->

## Summary

<!-- 1–3 sentences: what this PR changes and why it's needed. Don't list files; the diff already shows them. -->

## Linked card

<!-- Trello card URL or ID, e.g. https://trello.com/c/abcd1234 -->

## How

<!-- Short description of the approach. Skip if obvious from the diff. -->

## Test plan

CI gates (these run automatically — tick once they go green):

- [ ] `pnpm format:check`
- [ ] `pnpm --filter @h09a/web lint`
- [ ] `pnpm --filter @h09a/web typecheck`
- [ ] `pnpm --filter @h09a/web test`
- [ ] `pnpm --filter @h09a/web build`
- [ ] If backend changed: `pnpm --filter @h09a/api lint && pnpm --filter @h09a/api test`

If this PR changes the database schema (`models.py` or `alembic/versions/`):

- [ ] New Alembic revision included; `down_revision` is the current `main` head
- [ ] `models.py` matches the migration; `docs/db-schema.md` updated if the contract changed
- [ ] `cd apps/api && alembic upgrade head` succeeds on a fresh database (CI also runs this)

Manual verification:

<!-- The actual steps you ran. Be specific. Example:
     - Started both apps with `pnpm dev`
     - Opened http://localhost:3000 → homepage rendered
     - curl http://localhost:8000/health → {"status":"ok"} -->

## Out of scope

<!-- What is intentionally NOT in this PR, so reviewers don't ask about it. Write N/A if nothing to call out. -->

## Screenshots / video

<!-- Drag-drop screenshots or screen recordings for UI changes. Write N/A for backend / config / docs PRs. -->

## Notes for reviewer

<!-- Tradeoffs, follow-ups, places you want extra eyes on. Write N/A if there's nothing to flag. -->
