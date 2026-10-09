# Radio Net

Windows companion radio-comms app for the game WARDOGS. There are no accounts: the first launch stores a callsign on that PC, then the user joins a community with its invite code (the app remembers servers and rejoins in one click). Creating a community returns an admin key, kept locally, which is what create/delete channel and invite rotation require. Channels are a frequency plus a name (for example `59.5 Command`). Frequencies are 0.5 MHz steps from 30.0 to 87.5, always shown to one decimal (`50.0`, `50.5`), and stored as integer kHz. Each player tunes any number of channels to listen, and transmits on one. Voice runs on a self-hosted LiveKit server. The desktop client is Electron, React, and TypeScript, with a keybind settings screen (keys and mouse buttons, including Mouse 4 and Mouse 5) and a click-through overlay.

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
(cd spike/server && npm i && npm start) &  # API on :8787; seeds "War Dogs NZ (dev)", invite DEVN-ET01, admin key rnk_dev
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

That opens a mocked War Dogs NZ net (five channels). Talkers appear and drop on their own so the corner overlay (display name plus channel) can be seen on the game backdrop. Press `F2` for the channel wheel: hover a slice, left-click to transmit there, right-click to mute, scroll to step the whole 30.0–87.5 grid (a frequency another slice already has is skipped), Shift+scroll for volume, and `+` to pick a channel that is not tuned yet (an admin can enter a frequency to create one). Tuning a channel plays a short squelch; settings can turn UI sounds off or change their volume. Hold Space to talk. `F10` hides the overlay. The bar along the bottom forces those states (one talker, two talkers, you talking, a deleted channel).

`npm run preview:build` writes a static site to `spike/client/preview-dist` with relative asset paths. The **UI preview** GitHub Action builds that on every push and uploads it as the `ui-preview` artifact. Pushes to `main` and the current feature branch also deploy GitHub Pages at [https://tubss2.github.io/radio-net/](https://tubss2.github.io/radio-net/) once the repository source is GitHub Actions. The Actions token cannot create that site: the first time, open **Settings → Pages → Build and deployment** and set **Source** to **GitHub Actions**. Until then the artifact is still uploaded and the deploy job skips.

## Windows installer

The **Windows installer** workflow builds an unsigned NSIS installer on `windows-latest` on every push. A manual run can override the baked URLs once the workflow file is on the default branch (GitHub does not offer **Run workflow** for a file that exists only on a feature branch). These are baked into the client:

| Input | Env | Default |
|---|---|---|
| `api_url` | `VITE_API_URL` | `https://radio-149-28-170-200.sslip.io` |
| `livekit_url` | `VITE_LIVEKIT_URL` | `wss://lk-149-28-170-200.sslip.io` |

`RN_FAKE_MEDIA` is not set. The job fails if that variable is present, so a release build cannot ship the fake microphone.

The current client version is **0.4.3**. The release is `RadioNet-Setup-0.4.3.exe` on the public GitHub Release `v0.4.3` (Actions artifact name `RadioNet-Setup-0.4.3`, which also holds `latest.yml` and the blockmap). Windows SmartScreen warns because the installer is unsigned: choose **More info**, then **Run anyway**.

The installed app checks that public release on startup and every four hours, downloads in the background, and shows **Update ready** with **Restart now** and **Later**. Signature checks are off until the installer is code-signed. Anyone who can publish a GitHub Release on this repo can ship a build the client will install.

### Bumping the version

The client version is semver in [`spike/client/package.json`](spike/client/package.json). Bump it on each user-facing release. From `spike/client`:

```bash
npm version 0.5.0 --no-git-tag-version
```

Use the next version in place of `0.5.0`. That updates `package.json` and `package-lock.json`. Commit the result, then tag the same commit and push the tag:

```bash
git tag v0.5.0
git push origin v0.5.0
```

The tag must be `v` plus the `package.json` version. That workflow run publishes `RadioNet-Setup-<version>.exe`, `RadioNet-Setup-<version>.exe.blockmap`, and `latest.yml` to a public GitHub Release with `GITHUB_TOKEN`. A manual **Windows installer** run does the same when **publish** is left on (it also creates the tag). Every other push only uploads the Actions artifact.

| Piece | Name for 0.4.3 |
|---|---|
| NSIS file | `RadioNet-Setup-0.4.3.exe` |
| Blockmap | `RadioNet-Setup-0.4.3.exe.blockmap` |
| Update feed | `latest.yml` on the `v0.4.3` GitHub Release |
| Actions artifact | `RadioNet-Setup-0.4.3` |
| Installer and app exe properties | File version and Product version `0.4.3` |
| In-app keybinds settings | `Radio Net 0.4.3` |
