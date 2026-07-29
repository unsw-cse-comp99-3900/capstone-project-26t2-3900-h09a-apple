# CI/CD

Current continuous integration and deployment behaviour for this monorepo.
Branching rules live in [docs/git-workflow.md](../git-workflow.md).

## Workflow file

Primary pipeline: [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)

Triggers:

- `pull_request` to `main` or `develop`
- `push` to `main` or `develop`

Additional PR policy workflows:

- `.github/workflows/pr-title.yml` (Jira key in title)
- `.github/workflows/content-policy.yml` (block Chinese and em dash in PR title/body/changed lines)
- `.github/workflows/commit-policy.yml` (block forbidden AI commit trailers)
- `.github/workflows/visual-evidence.yml` (advisory visual evidence checks)

## Jobs on pull requests

| Job         | Purpose                                                                     |
| ----------- | --------------------------------------------------------------------------- |
| `web`       | `pnpm format:check`, web lint, turbo typecheck, web test, web build         |
| `api`       | ruff lint/format, Alembic up/down/up, `pytest --cov=app`                    |
| `extension` | format, lint, typecheck, test, build                                        |
| `desktop`   | native deps on Linux, format, lint, typecheck, desktop-storage tests, build |

`deploy-web` is **not** a PR job. It runs on push to `main` after `web`, `api`,
`extension`, and `desktop` succeed, and deploys the Next.js app via Vercel CLI
using repository secrets.

## Required status checks (branch protection)

For both `main` and `develop` (as configured for the protected-develop workflow):

- `web`
- `api`
- `content-policy`
- `pr-title`
- `commit-policy`

Also enforced: pull request before merge, at least one approving review, no
force-push / direct push, admins included.

`extension` and `desktop` still run in CI but are not listed as required merge
gates. `visual-evidence` is not required. `deploy-web` is post-merge on `main`.

## Migration gate

API CI runs:

```text
alembic upgrade head
alembic downgrade base
alembic upgrade head
```

New revisions should chain from the current **develop** head when feature work
targets `develop`.

## Coverage

API tests run with `--cov=app --cov-report=term`. The workflow prints coverage;
treat the report as visibility, not a documented hard percentage fail gate
unless the workflow is later changed to enforce one.

## Branch relationship

```text
feature branch  ->  PR + CI  ->  develop  ->  release PR + CI  ->  main
                                                      |
                                                      +-> deploy-web (Vercel)
```

Do not open ordinary feature PRs to `main`. Promote `develop` to `main` only for
a planned release cut.

## Related

- [docs/git-workflow.md](../git-workflow.md)
- [docs/testing/testing-strategy.md](../testing/testing-strategy.md)
- [docs/deployment.md](../deployment.md)
- [docs/teamwork-assessment-evidence.md](../teamwork-assessment-evidence.md)
