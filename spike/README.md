# Radio Net: M1 spike

Throwaway-quality but tidy proof of the core: in-app communities/channels, one LiveKit room per channel, listen-many / talk-one, switch TX, global hotkeys, overlay. Ready to push to a private repo (each package has its own `.gitignore`; no secrets are committed, and LiveKit dev keys are the public `devkey/secret`).

```
spike/
  livekit/   run-dev.sh: downloads livekit-server v1.13.9 (linux x64) and runs it in --dev mode on 127.0.0.1:7880
  server/    Fastify API: communities (invite code + admin key, no accounts), channels, LiveKit token minting. JSON file store when RN_DATA_FILE is set.
  client/    Electron + React + TS app (electron-vite). Main: windows, overlay, uiohook hotkeys, safeStorage. Renderer: RadioEngine (livekit-client) + UI.
  tests/     radio-e2e.ts (4 bot players, headless) and electron-smoke.ts (drives the real app on Xvfb with a fake mic)
  shots/     screenshots from the Electron smoke test
```

## Run it (Linux box)

```bash
livekit/run-dev.sh &                       # LiveKit dev server
(cd server && npm i && npm start) &        # API on :8787; seeds community "War Dogs NZ (dev)", invite DEVN-ET01
(cd server && npm test)                    # API/unit tests (no accounts, admin key, file store)
(cd client && npm test)                    # channel-wheel behaviour
(cd tests && npm i && npm run e2e)         # 14 voice checks with bots
# Electron app on a virtual display:
(cd client && npm i && npx electron-vite build)
Xvfb :99 -screen 0 1280x800x24 +extension RECORD &
(cd tests && npx tsx electron-smoke.ts)    # 8 checks, screenshots -> shots/
```

Browser UI preview (no Electron, no server): `npm run preview` in `client/`. See the root README for the wheel keys and the static-site build. The UI preview GitHub Action uploads that site as `ui-preview`.

On Windows, for the M1 test: point `VITE_API_URL` at the API, run `npm run dev` in `client/`, and use `RN_USER_DATA=<dir>` to run two profiles on one PC. An unsigned NSIS installer is built by the Windows installer workflow (`RadioNet-Setup-<version>.exe`, currently `RadioNet-Setup-0.3.2.exe`). The same version is the Actions artifact name, the exe file properties, and the line in the keybinds settings. Bump it from `client/` with `npm version <version> --no-git-tag-version` (see the root README). SmartScreen: **More info**, then **Run anyway**. `RN_FAKE_MEDIA` is not set in that build.

## Results (Fri 9 Oct 2026)

- server unit tests **14/14** (no accounts: admin key, session join, JSON file round-trip), voice e2e **14/14** on the older account API and not re-run after the admin-key change, Electron smoke **8/8** from before the callsign screen. Details in `../docs/PLAN.md` §11.
- `tests/radio-e2e.ts` can target a remote server with `API_URL`, `SETUP_CODE`, `LIVEKIT_WS`, `LIVEKIT_HTTP`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET`. A run from NZ against the Sydney VPS also passed 14/14 (`../deploy/README.md`).
- client channel-wheel tests cover the radial behaviour (open/hold, mute, frequency steps, volume, add). The Electron smoke run above is from before the wheel and was not repeated.
- Not verified: anything Windows-specific (anti-cheat, hotkeys while WARDOGS has focus, overlay transparency over the game, DPAPI), real mics, real network.

## Known spike shortcuts

- The dev server keeps communities in memory unless `RN_DATA_FILE` is set. The VPS setup writes `/var/lib/radionet/store.json`. No HTTPS on the local spike (Caddy on the VPS). Channel list polls every 10 s.
- Keybinds have a settings screen (click a slot, press a key or mouse button, conflicts, clear, reset). Defaults stay Mouse 4 PTT, F2 channel wheel, F10 overlay, Mouse 5 cycles TX. A profile that already saved a wheel key keeps it. The wheel takes focus while it is open so scroll works immediately; if the game keeps focus, the global hook still steps the dial. Hold F2 and press 1–9 for the same fallback.
- Electron can hang on quit under the test harness (likely `uIOhook.stop()`); to fix in M3.
- `RN_FAKE_MEDIA=1` enables a fake mic for tests; must never be set in release builds.
