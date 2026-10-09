# Radio Net

Windows companion radio-comms app for the game WARDOGS. A group creates a community in the app and shares an invite code. Admins add channels as a frequency plus a name (for example `59.500 Command`). Each player tunes any number of channels to listen, and transmits on one. Voice runs on a self-hosted LiveKit server. The desktop client is Electron, React, and TypeScript, with passive global hotkeys (including mouse buttons) and a click-through overlay.

This repository holds the v0.2 plan and the M1 spike. The spike is a working local proof of the core, not the finished app.

## Layout

| Path | What it is |
|---|---|
| [`docs/PLAN.md`](docs/PLAN.md) | Scope and plan (v0.2) |
| [`docs/UI.md`](docs/UI.md), [`docs/mockup.html`](docs/mockup.html), [`docs/mockup.png`](docs/mockup.png) | UI direction and static mockup |
| [`docs/providers.md`](docs/providers.md) | Voice-provider comparison |
| [`docs/naming.md`](docs/naming.md) | Name and domain shortlist (nothing bought) |
| [`docs/discord-setup.md`](docs/discord-setup.md) | Discord login setup, backlog only |
| [`docs/radio-net-feasibility.md`](docs/radio-net-feasibility.md) | Feasibility study that led to this project |
| [`spike/`](spike/README.md) | M1 spike: API server, Electron client, LiveKit dev runner, tests, screenshots |

## Run the spike

Commands below are from the repo root. The spike README uses the same steps with paths relative to `spike/`.

The LiveKit binary is not in git. `spike/livekit/run-dev.sh` downloads **livekit-server v1.13.9** (Linux x64) from the [LiveKit v1.13.9 release](https://github.com/livekit/livekit/releases/tag/v1.13.9) into `spike/livekit/bin/` (gitignored) and starts it in `--dev` mode on `127.0.0.1:7880`. Dev API key and secret are the public LiveKit dev pair (`devkey` / `secret`).

```bash
spike/livekit/run-dev.sh &                 # LiveKit dev server (downloads the binary on first run)
(cd spike/server && npm i && npm start) &  # API on :8787; seeds "War Dogs NZ (dev)", invite DEVN-ET01
(cd spike/server && npm test)              # API and unit tests
(cd spike/tests && npm i && npm run e2e)   # headless voice checks (needs LiveKit + API)
```

Electron smoke test (Linux, virtual display):

```bash
(cd spike/client && npm i && npx electron-vite build)
Xvfb :99 -screen 0 1280x800x24 +extension RECORD &
(cd spike/tests && npx tsx electron-smoke.ts)   # screenshots -> spike/shots/
```

On Windows, for a local M1 try: point `VITE_API_URL` at the API, run `npm run dev` in `spike/client/`, and use `RN_USER_DATA=<dir>` to run two profiles on one PC. Details and known shortcuts are in [`spike/README.md`](spike/README.md).
