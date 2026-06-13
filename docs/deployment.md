# Deployment

## Frontend — Vercel preview deploys

The Next.js frontend (`apps/web`) is deployed to Vercel. Every PR gets its own
preview URL, posted automatically as a comment on the PR. Merges into `main`
update the production URL.

### One-time setup (do this once, not per-developer)

Whoever has admin access to the GitHub repo does this once:

1. Sign in to <https://vercel.com> with the GitHub account that owns/admins the
   repo. Use the free Hobby plan.
2. Click **Add New… → Project**, then import
   `unsw-cse-comp99-3900/capstone-project-26t2-3900-h09a-apple`.
3. In the configuration screen:
   - **Framework Preset**: Next.js (auto-detected)
   - **Root Directory**: `apps/web`
   - **Install Command**: leave default (`pnpm install`)
   - **Build Command**: leave default (`next build`)
   - **Output Directory**: leave default (`.next`)
4. Under **Environment Variables**, add at least:
   - `NEXT_PUBLIC_API_BASE_URL` — for now, a placeholder like
     `http://localhost:8000` is fine; replace with the real backend URL once
     the backend is deployed.
   - `NEXT_PUBLIC_APP_NAME` — `H09A Apple`
5. Click **Deploy**. The first deploy takes ~2 min.

After this, no further action is needed: every PR push automatically triggers a
preview build and Vercel posts the URL on the PR.

### Verifying it works

Open any PR. Within ~2 minutes the **Vercel bot** should comment with a preview
URL like `https://h09a-apple-pr-12-h09a-apple.vercel.app`. Click it — the
homepage should load.

### When the backend is deployed later

Update `NEXT_PUBLIC_API_BASE_URL` in Vercel project settings to point at the
real backend URL. Vercel rebuilds previews automatically on the next push.

## Backend — not deployed yet

The FastAPI backend (`apps/api`) is **not deployed** in this card. Local dev
and CI tests are sufficient for Sprint 1. A backend deploy target (Render /
Railway / Fly.io / etc.) will be picked in a later card.

Until then, frontend preview deploys can render but cannot make real API
calls. That's fine — Sprint 1 UI review is purely visual.
