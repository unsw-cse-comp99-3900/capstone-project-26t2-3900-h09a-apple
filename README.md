# H09A Apple

UNSW COMP3900 26T2 capstone project.

Monorepo with a Next.js frontend (`apps/web`) and a FastAPI backend (`apps/api`).
Shared TypeScript types live in `packages/types`.

## Requirements

- Node 20+
- pnpm 9+
- Python 3.11

## Setup

```bash
pnpm install

cd apps/api
python -m venv .venv
source .venv/Scripts/activate   # Windows Git Bash; use .venv/bin/activate on macOS/Linux
pip install -r requirements.txt -r requirements-dev.txt
cd ../..

cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
cp apps/api/.env.example apps/api/.env
```

## Run

```bash
pnpm dev          # frontend + backend
pnpm dev:web      # only frontend (http://localhost:3000)
pnpm dev:api      # only backend  (http://localhost:8000)
```

Other scripts: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm format`.

## Branches

- `main` — protected, only updated through PRs that pass CI.
- `<name>-dev` — personal working branch (e.g. `xingzhili-dev`).
- `feat/...`, `fix/...` — short-lived feature/fix branches.
