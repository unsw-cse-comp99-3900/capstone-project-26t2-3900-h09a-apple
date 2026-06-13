# @h09a/extension

Chrome Manifest V3 extension shell for WorkTrace AI workflow capture.

The current popup manages local UI state only. It does not capture browser
events, persist sessions, or communicate with the backend.

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

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Select **Load unpacked**.
4. Choose `apps/extension/dist`.

After rebuilding, use the extension card's refresh button before reopening the
popup.
