# @h09a/extension

Chrome Manifest V3 extension for WorkTrace workflow capture (record events,
screenshots, and assemble a session payload for the web review flow).

## Development

Run these commands from the repository root:

```sh
pnpm --filter @h09a/extension lint
pnpm --filter @h09a/extension typecheck
pnpm --filter @h09a/extension test
pnpm --filter @h09a/extension build
```

The build copies extension runtime files into `apps/extension/dist`.

## Load in Chrome

1. Run `pnpm --filter @h09a/extension build`.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Select **Load unpacked**.
5. Choose `apps/extension/dist`.

After rebuilding, use the extension card's refresh button before reopening the
popup.

## Backend integration

Session submission goes through the web app (`/session/review`). The API requires
a Bearer token on protected routes; see the root `README.md` for auth and local
database setup.
