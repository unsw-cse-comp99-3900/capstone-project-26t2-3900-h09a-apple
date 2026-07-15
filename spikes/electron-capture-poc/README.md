# Electron global capture POC (H09AAPPLE-70)

Throwaway prototype — **not** part of the monorepo build. Validates global click/key capture,
foreground app identification, and throttled full-screen screenshots from a hidden Electron app.

## Prerequisites

- Windows 10/11 or macOS (test both per card)
- Node.js 20+
- Windows: Visual Studio **Desktop development with C++** if `uiohook-napi` rebuild fails

## Install

```bash
cd spikes/electron-capture-poc
npm install
```

`postinstall` runs `electron-rebuild` for **uiohook-napi** only. On Windows, `active-win` uses its
prebuilt binary and works in Electron without a separate rebuild.

## Run (incremental validation)

```bash
npm run start:step1   # global hooks only
npm run start:step2   # + foreground app name
npm start             # full pipeline (= step 3)
```

Logs: `output/events.log` (gitignored)  
Screenshots: `output/screenshots/*.png` (gitignored)

## Log shape

```json
{
  "event_type": "CLICK",
  "timestamp": 1710000000000,
  "foreground_app": "Microsoft Edge",
  "window_title": "Example",
  "screenshot_ref": "output/screenshots/1710000000000-abc123.png",
  "x": 100,
  "y": 200,
  "button": 1
}
```

## macOS notes

Expect **Accessibility** and **Screen Recording** permissions:

- **Accessibility** — global hooks (`uiohook`) and browser tab URL (optional).
- **Screen Recording** — required for `desktopCapturer` **and** for `active-win` to return
  `window_title` (macOS 10.15+ returns empty title without it).

In dev, add **Electron** (not just Terminal) under System Settings → Privacy & Security.

Record every prompt (text, steps, restart required?) and add to
`docs/spikes/electron-desktop-capture-review.md` §7.4.

Findings: same doc → **Validation Results**.
