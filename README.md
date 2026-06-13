# H09A Apple

UNSW COMP3900 26T2 capstone project.

Monorepo with a Next.js frontend (`apps/web`), a FastAPI backend (`apps/api`),
and a placeholder slot for the Chrome MV3 extension (`apps/extension`).
Shared TypeScript types live in `packages/types`.

## Requirements

- Node 20+
- pnpm 9+
- Python 3.11

## Setup

```bash
pnpm install

cd apps/api
py -3.11 -m venv .venv          # Windows; macOS/Linux: python3.11 -m venv .venv
source .venv/Scripts/activate   # Windows Git Bash; macOS/Linux: source .venv/bin/activate
pip install -r requirements-dev.txt
cd ../..

cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
cp apps/api/.env.example apps/api/.env
```

## Run

`pnpm dev` runs the backend through `uvicorn`, which is only on `PATH` when the
Python venv is active in your shell. Activate it once per terminal session:

```bash
source apps/api/.venv/Scripts/activate   # macOS/Linux: source apps/api/.venv/bin/activate
```

Then:

```bash
pnpm dev          # frontend + backend
pnpm dev:web      # only frontend (http://localhost:3000)
pnpm dev:api      # only backend  (http://localhost:8000)
```

Other scripts: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm format`.

## Branches

- `main` — only updated through PRs that pass CI. Repo admin should enable
  branch protection (Settings → Branches → Add rule for `main` → require status
  checks `web` and `api` to pass) so failing CI blocks merges.
- `<TICKET-ID>-<kebab-case-card-title>` — one branch per Trello card,
  e.g. `H09AAPPLE-21-dev-ops-set-up-project-monorepo-and-ci-cd-pipeline`.
  Use the name Trello auto-generates from the card title; don't shorten by
  hand. Created when work on a card starts, deleted after the PR is merged.

## Deployment

Frontend preview deploys are wired up via Vercel: every PR gets its own
preview URL, posted as a comment on the PR. See [`docs/deployment.md`](docs/deployment.md)
for one-time Vercel setup steps.
