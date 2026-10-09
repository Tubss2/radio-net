# Radio Net

Windows companion radio-comms app for the game WARDOGS. A group creates a community in the app and shares an invite code. Admins add channels as a frequency plus a name (for example `59.500 Command`). Each player tunes any number of channels to listen, and transmits on one. Voice runs on a self-hosted LiveKit server. The desktop client is Electron, React, and TypeScript, with passive global hotkeys (including mouse buttons) and a click-through overlay.

This repository holds the v0.2 plan, the M1 spike, and a Sydney VPS deploy kit. The spike is a working local proof of the core, not the finished app.

## Layout

| Path | What it is |
|---|---|
| [`docs/PLAN.md`](docs/PLAN.md) | Scope and plan (v0.2) |
| [`docs/UI.md`](docs/UI.md), [`docs/mockup.html`](docs/mockup.html), [`docs/mockup.png`](docs/mockup.png) | UI direction and static mockup |
| [`docs/providers.md`](docs/providers.md) | Voice-provider comparison |
| [`docs/naming.md`](docs/naming.md) | Name and domain shortlist (nothing bought) |
| [`docs/discord-setup.md`](docs/discord-setup.md) | Discord login setup, backlog only |
| [`docs/radio-net-feasibility.md`](docs/radio-net-feasibility.md) | Feasibility study that led to this project |
| [`docs/anticheat-and-contacts.md`](docs/anticheat-and-contacts.md) | Anti-cheat notes, who to contact, and lower-risk input designs |
| [`spike/`](spike/README.md) | M1 spike: API server, Electron client, LiveKit dev runner, tests, screenshots |
| [`deploy/`](deploy/README.md) | Vultr Sydney deploy kit: cloud-init, setup, pack/deploy scripts, systemd units |

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

## Try the UI in a browser

No Electron build, no LiveKit, and no server. From `spike/client`:

```bash
npm i
npm run preview
```

That opens a mocked War Dogs NZ net (five channels). Talkers appear and drop on their own so the corner overlay (display name plus channel) can be seen on the game backdrop. Press `G` for the channel wheel: hover a slice, left-click to transmit there, right-click to mute, scroll to step the frequency, Shift+scroll for volume, and `+` to add a channel. Hold Space to talk. `F10` hides the overlay. The bar along the bottom forces those states (one talker, two talkers, you talking, a deleted channel).

`npm run preview:build` writes a static site to `spike/client/preview-dist` with relative asset paths. The **UI preview** GitHub Action builds that on every push and uploads it as the `ui-preview` artifact.

GitHub Pages is not usable for this private repository: the token cannot read or create a Pages site (`GET /repos/Tubss2/radio-net/pages` returns 403). The preview is the workflow artifact.

## Windows installer

The **Windows installer** workflow builds an unsigned NSIS installer on `windows-latest` on every push. A manual run can override the baked URLs once the workflow file is on the default branch (GitHub does not offer **Run workflow** for a file that exists only on a feature branch). These are baked into the client:

| Input | Env | Default |
|---|---|---|
| `api_url` | `VITE_API_URL` | `https://radio-149-28-170-200.sslip.io` |
| `livekit_url` | `VITE_LIVEKIT_URL` | `wss://lk-149-28-170-200.sslip.io` |

`RN_FAKE_MEDIA` is not set. The job fails if that variable is present, so a release build cannot ship the fake microphone.

Download `RadioNet-Setup.exe` from the workflow artifacts (artifact name `RadioNet-Setup`). Windows SmartScreen warns because the installer is unsigned: choose **More info**, then **Run anyway**.
