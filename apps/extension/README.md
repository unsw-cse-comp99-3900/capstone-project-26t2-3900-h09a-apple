# @h09a/extension

Reserved slot for the Chrome MV3 extension. This package is intentionally empty
right now — only `package.json` exists so that pnpm registers the workspace
slot and the directory layout is stable.

Real scaffolding (manifest, bundler, popup/content/background scripts, etc.)
lands in a dedicated future Sprint card. Don't add code here without an owning
ticket.

When this is filled in, the package is expected to include:

- `manifest.json` (MV3)
- A bundler — to be picked between Vite + custom config, [Plasmo](https://docs.plasmo.com/),
  or [WXT](https://wxt.dev/) when the extension card is picked up
- Background service worker, one or more content scripts, a popup
- `lint`, `typecheck`, `test`, `build` scripts wired into the root `pnpm`
  commands and an additional `extension` job in `.github/workflows/ci.yml`
