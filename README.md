# Radio Net

Group voice radio for WARDOGS. The primary product is the web app at [https://tubss2.github.io/radio-net/](https://tubss2.github.io/radio-net/), talking to the Sydney API and LiveKit. The Windows desktop app stays for the overlay and for push-to-talk while a game is in front. There are no accounts: the first launch stores a callsign in the browser or on that PC, then the user joins a community with its invite code (the app remembers servers and rejoins in one click). Creating a community returns an admin key, kept locally, which is what create/delete channel and invite rotation require. Channels are a frequency plus a name (for example `59.5 Command`). Frequencies are 0.5 MHz steps from 30.0 to 87.5, always shown to one decimal (`50.0`, `50.5`), and stored as integer kHz. Each player tunes any number of channels to listen, and transmits on one. Voice runs on a self-hosted LiveKit server. The desktop client is Electron, React, and TypeScript, with a keybind settings screen (keys and mouse buttons, including Mouse 4 and Mouse 5) and a click-through overlay. The web app uses the same screens.

This repository holds the v0.2 plan, the M1 spike, and a Sydney VPS deploy kit. The spike is a working local proof of the core, not the finished app.

## Privacy

Radio Net has no account and no telemetry. A callsign, the servers you join, keybinds, and (on the PC that created a community) an admin key stay in an OS-encrypted profile on that computer when Windows DPAPI is available. The app sends the callsign and invite code to the community server you type in, and it sends voice to that server's LiveKit while push-to-talk is held. The microphone device is opened earlier, when you tune a channel you can talk on, with the track muted until you hold the talk key.

A global keyboard and mouse hook runs so push-to-talk works while the game is in front. The hook can see other keys. This version keeps only the keys and mouse buttons you bind, plus Escape, digits, and the scroll wheel while the channel wheel is open. Those other keystrokes are not written to the log and are not sent to the server. Quit the app when you are done; the hook stops with the process.

The Windows installer is unsigned. The app checks public GitHub Releases for Tubss2/radio-net and will install a downloaded build after you click Restart. Signature verification is off until the installer is code-signed. Treat a GitHub account compromise as a compromise of the app.

The full notes are in [`docs/PRIVACY.md`](docs/PRIVACY.md). An outside-style assessment of the v0.4.3 installer is in [`docs/SECURITY-REVIEW.md`](docs/SECURITY-REVIEW.md).

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
| [`docs/SECURITY-REVIEW.md`](docs/SECURITY-REVIEW.md) | Outside review: what would worry someone installing the app |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Threat model: assets, attackers, trust boundaries |
| [`docs/PRIVACY.md`](docs/PRIVACY.md) | What the app reads, what leaves the PC, and what stays |
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

`npm run preview:build` writes that mock to `spike/client/preview-dist` with relative asset paths. The product site is a different build:

```bash
VITE_API_URL=http://127.0.0.1:8787 npm run web
```

That serves the real radio on port 5175 (the API defaults to the Sydney host when `VITE_API_URL` is unset). Callsign, server history, and settings stay in `localStorage`. The join session stays in `sessionStorage` for this tab. Space or the large button holds push-to-talk, and both release when the tab is hidden. `npm run web:build` writes `spike/client/web-dist`.

**Use phone** shows a QR code for a one-time link. The phone page holds the button; this computer's mic goes live. **Helper app** connects to the Windows helper window on `127.0.0.1:47321` when that exe is open. Details: [`docs/PHONE-PTT.md`](docs/PHONE-PTT.md) and [`docs/PTT-HELPER.md`](docs/PTT-HELPER.md). The public API needs those phone routes deployed before the QR works against Sydney. The helper needs no server change.

The **Web app** GitHub Action builds the web app and this mock on every push and uploads them as the `web-site` artifact. Pushes to `main` and `cursor/local-callsign-keybinds-3d59` deploy GitHub Pages at [https://tubss2.github.io/radio-net/](https://tubss2.github.io/radio-net/) when **Settings → Pages → Source** is **GitHub Actions**. The Actions token cannot create that site. If the configure step fails, the job prints that Settings path and skips the upload. The mock is [https://tubss2.github.io/radio-net/preview/](https://tubss2.github.io/radio-net/preview/).

## Windows installer

The **Windows installer** workflow builds an unsigned NSIS installer on `windows-latest` on every push. A manual run can override the baked URLs once the workflow file is on the default branch (GitHub does not offer **Run workflow** for a file that exists only on a feature branch). These are baked into the client:

| Input | Env | Default |
|---|---|---|
| `api_url` | `VITE_API_URL` | `https://radio-149-28-170-200.sslip.io` |
| `livekit_url` | `VITE_LIVEKIT_URL` | `wss://lk-149-28-170-200.sslip.io` |

`RN_FAKE_MEDIA` is not set. The job fails if that variable is present, so a release build cannot ship the fake microphone.

The current client version is **0.4.4**. The release is `RadioNet-Setup-0.4.4.exe` on the public GitHub Release `v0.4.4` (Actions artifact name `RadioNet-Setup-0.4.4`, which also holds `latest.yml` and the blockmap). Windows SmartScreen warns because the installer is unsigned: choose **More info**, then **Run anyway**.

The installed app checks that public release on startup and every four hours, downloads in the background, and shows **Update ready** with **Restart now** and **Later**. Signature checks are off until the installer is code-signed. Anyone who can publish a GitHub Release on this repo can ship a build the client will install. The installer workflow also writes `SHA256SUMS.txt` (SHA-256 of the exe) into the Actions artifact and, when it publishes, attaches that file to the GitHub Release. That checksum matches the file. It does not prove who built it.

### Bumping the version

The client version is semver in [`spike/client/package.json`](spike/client/package.json). Bump it on each user-facing release. From `spike/client`:

```bash
npm version 0.5.0 --no-git-tag-version
```

Use the next version in place of `0.5.0`. That updates `package.json` and `package-lock.json`. Rewrite [`spike/client/release-notes.md`](spike/client/release-notes.md) in plain English for that version. The publisher attaches that file to the GitHub Release and to `latest.yml`. Commit the result, then tag the same commit and push the tag:

```bash
git tag v0.5.0
git push origin v0.5.0
```

The tag must be `v` plus the `package.json` version. That workflow run publishes `RadioNet-Setup-<version>.exe`, `RadioNet-Setup-<version>.exe.blockmap`, and `latest.yml` to a public GitHub Release with `GITHUB_TOKEN`. A manual **Windows installer** run does the same when **publish** is left on (it also creates the tag). Every other push only uploads the Actions artifact.

| Piece | Name for 0.4.4 |
|---|---|
| NSIS file | `RadioNet-Setup-0.4.4.exe` |
| Blockmap | `RadioNet-Setup-0.4.4.exe.blockmap` |
| Update feed | `latest.yml` on the `v0.4.4` GitHub Release |
| Actions artifact | `RadioNet-Setup-0.4.4` |
| Installer and app exe properties | File version and Product version `0.4.4` |
| In-app keybinds settings | `Radio Net 0.4.4` |
