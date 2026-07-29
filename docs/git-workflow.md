# Git Workflow

## Current workflow (Sprint 3 onward)

```
feature branch  ->  develop  ->  main
```

1. Create feature branches from the latest `develop`.
2. Open pull requests that target `develop`.
3. Require teammate review and green CI before merge.
4. Merge `develop` into `main` only for stable releases via a release PR.

Do not open ordinary feature PRs directly against `main`.

## Branch protection

Both `main` and `develop` are protected:

- Changes require a pull request
- At least one approving review
- Required CI checks must pass
- Force pushes are disabled
- Direct pushes are disabled

## Creating a feature branch

```bash
git fetch origin
git switch develop
git pull origin develop
git switch -c H09AAPPLE-XX-short-description
```

## Syncing with develop

The team uses **merge** to sync feature branches with `develop` (not rebase).
Do not mix merge and rebase on the same branch.

```bash
git switch H09AAPPLE-XX-short-description
git fetch origin
git merge origin/develop
```

Resolve conflicts, run tests, then push.

## Pull requests

### Feature work

- Base branch: `develop`
- Title: Conventional Commits plus a Jira key, e.g. `feat(api): async friction pipeline H09AAPPLE-37`
- Wait for CI and at least one approval

### Release

- Base branch: `main`
- Head branch: `develop`
- Title example: `release: promote develop to main H09AAPPLE-XX`
- Only after develop is stable for the release cut

## Git Workflow Improvement

During the earlier sprints, feature branches were created from and merged
directly into main because the team had not yet established a separate
integration branch.

From Sprint 3 onward, the team adopted the following workflow:

1. Feature branches are created from develop.
2. Feature branches are merged into develop through reviewed pull requests.
3. Develop is merged into main only for stable releases.
4. Main and develop are protected by required approvals and CI checks.

Past history on `main` is kept as-is. We do not rewrite old commits or recreate
already-merged work only to invent a develop-first timeline.

## Related process ticket

Track the institutionalization of this workflow under a Jira process card such as:

`H09AAPPLE-XX Establish protected develop branch and Git workflow`
