# Windows push-to-talk helper

`helper/` is a small tray program for the web app. It is not the Electron client, and this repo does not publish it as a GitHub Release.

It listens on `127.0.0.1:47321` only. A page may connect when its `Origin` is exactly `https://tubss2.github.io`, or `http://127.0.0.1` / `http://localhost` with any port. Anything else gets HTTP 403 before the socket upgrades. The tray shows a random pairing code. The page sends that code once, plus the single key or mouse side button to watch (`Mouse 4` or `Mouse 5`). After that the helper sends `{"t":"down"}` and `{"t":"up"}` and nothing else.

On Windows it uses Raw Input (`RegisterRawInputDevices` with `RIDEV_INPUTSINK`) for keyboard or mouse, and drops every event that is not the watched key or button. It does not install a low-level hook.

The **PTT helper** GitHub Action builds `RadioNetHelper.exe` on `windows-latest` and uploads it as the `RadioNetHelper` artifact. Download that artifact. It is not attached to a Release, so installed desktop apps will not auto-update from it.

## Link it from the page

In the web app, **Link helper**, type the tray code, and choose the talk key or a side button. If the socket does not open, the page says: the helper is not running, or this browser blocked the localhost link. Use the phone button, or the desktop app, for in-game push-to-talk.

Chromium allows `ws://127.0.0.1` from the GitHub Pages origin. If another browser blocks it, use the phone.

The desktop app already has a global key. It does not show **Link helper**.

## Build

```bash
cd helper && cargo build --release
```

The release profile is size-focused (`opt-level = "z"`, link-time optimisation, one codegen unit, stripped, abort on panic). The target is a single exe of about 1–3 MB. `cargo test` covers the origin check, the pair message, and the localhost socket. A Windows compile check is `cargo check --target x86_64-pc-windows-msvc`. This program does not need a server change.
