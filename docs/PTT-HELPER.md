# Windows push-to-talk helper

`helper/` is a small tray program for the web app. It is not the Electron client. The Windows build is attached to the [helper-1 release](https://github.com/Tubss2/radio-net/releases/download/helper-1/RadioNetHelper.exe). That release is separate from the desktop installer, so it is not an app update.

It listens on `127.0.0.1:47321` only. A page may connect when its `Origin` is exactly `https://tubss2.github.io`, or `http://127.0.0.1` / `http://localhost` with any port, and its `Host` is `127.0.0.1` or `localhost`. Anything else gets HTTP 403 before the socket upgrades. A Private Network Access preflight gets `Access-Control-Allow-Private-Network` only for that same allowlist. The tray shows a 12-character pairing code the first time. The page sends that code once, plus the single key or mouse side button to watch (`Mouse 4` or `Mouse 5`). A successful code link burns the code. The helper answers with a 32-byte device token. The page keeps that token in `localStorage` for this origin (`rn.helper`). The helper stores only the SHA-256 of the token, and the watched key, in `%APPDATA%\RadioNet\helper-device.bin`. On Windows that file is sealed with DPAPI. Later visits send the token and do not ask for a code. After the link the helper sends `{"t":"down"}` and `{"t":"up"}` only. The page may change the watched key, or forget the token.

Unlink is on the page and on the tray menu (right-click). The page tells the helper to forget, and deletes the token in this browser. The tray deletes the helper’s copy and tells an open page to forget. If the helper is not running, the page can only forget its own copy; use **Unlink this browser** on the tray when the icon is back. The helper file is not enough to connect, because it does not contain the token. A script on `https://tubss2.github.io` can read `localStorage` and hold the one watched key while the helper is running. Unlink revokes that. The tray menu can turn on “Start with Windows”. That stays off until the user ticks it.

On Windows it uses Raw Input (`RegisterRawInputDevices` with `RIDEV_INPUTSINK`) for keyboard or mouse, and drops every event that is not the watched key or button. It does not install a low-level hook.

The **PTT helper** GitHub Action builds `RadioNetHelper.exe` on `windows-latest`, uploads the `RadioNetHelper` artifact, and on `main` attaches the exe to the `helper-1` release. Download: https://github.com/Tubss2/radio-net/releases/download/helper-1/RadioNetHelper.exe

## Link it from the page

In the web app, **Set up push to talk**, then **Helper app**, then **Set up helper**, type the tray code once, and choose the talk key or a side button. The next time you open the radio, the page reconnects by itself. Change the key in that dialog while it is linked. **Unlink** forgets the browser. If the socket does not open, the page says: the helper is not running, or this browser blocked the localhost link. Use the phone button, or the desktop app, for in-game push-to-talk.

Chromium allows `ws://127.0.0.1` from the GitHub Pages origin. If another browser blocks it, use the phone.

The desktop app already has a global key. It does not show **Link helper**.

## Build

```bash
cd helper && cargo build --release
```

The release profile is size-focused (`opt-level = "z"`, link-time optimisation, one codegen unit, stripped, abort on panic). The target is a single exe of about 1–3 MB. `cargo test` covers the origin check, the device token, and the localhost socket. A Windows compile check is `cargo check --target x86_64-pc-windows-msvc`. This program does not need a server change.
