# Windows push-to-talk helper

`helper/` is a small always-visible window for the web app. It is not the Electron client, and it is not a tray icon. The Windows build is attached to the [helper-2 release](https://github.com/Tubss2/radio-net/releases/download/helper-2/RadioNetHelper.exe). That release is separate from the desktop installer, so it is not an app update. `helper-1` was the older tray build.

It listens on `127.0.0.1:47321` only. A page may connect when its `Origin` is exactly `https://tubss2.github.io`, or `http://127.0.0.1` / `http://localhost` with any port, and its `Host` is `127.0.0.1` or `localhost`. Anything else gets HTTP 403 before the socket upgrades. A Private Network Access preflight gets `Access-Control-Allow-Private-Network` only for that same allowlist. The window shows **Disconnected**, or **Connected to** the page origin, and a 12-character pairing code while nothing is linked. The page sends that code once. A successful code link burns the code. The helper answers with a 32-byte device token. The page keeps that token in `localStorage` for this origin (`rn.helper`). The helper stores only the SHA-256 of the token, and the watched key, in `%APPDATA%\RadioNet\helper-device.bin`. On Windows that file is sealed with DPAPI. Later visits send the token and do not ask for a code. After the link the helper sends `{"t":"down"}` and `{"t":"up"}` only.

**Set key** waits for one keyboard key or mouse side button (`Mouse 4` or `Mouse 5`) and saves it in that same file. Changing the key in the web app while linked updates the window. The window shows **Pressed** while that key is held. **Unlink** revokes the browser token and leaves the watched key in place. Closing the window exits the process: Raw Input is unregistered and the socket closes. Minimising to the taskbar leaves it running. It does not start with Windows. If an older build added a Run key, this build removes it.

A script on `https://tubss2.github.io` can read `localStorage` and hold the one watched key while the helper is running. Unlink revokes that. The helper file is not enough to connect, because it does not contain the token.

On Windows it uses Raw Input (`RegisterRawInputDevices` with `RIDEV_INPUTSINK`) for keyboard or mouse, and drops every event that is not the watched key or button. It does not install a low-level hook. While **Set key** is waiting, the next key or side button is the one that gets saved. Other keys are not written to the socket or to a log.

The **PTT helper** GitHub Action builds `RadioNetHelper.exe` on `windows-latest`, uploads the `RadioNetHelper` artifact, and on `main` attaches the exe to the `helper-2` release. Download: https://github.com/Tubss2/radio-net/releases/download/helper-2/RadioNetHelper.exe

## Link it from the page

In the web app, **Set up push to talk**, then **Link helper**, type the code from the helper window once, and choose the talk key or a side button. The next time you open the radio, the page reconnects by itself if the window is still open. Change the key in that dialog while it is linked, or with **Set key** in the window. **Unlink** forgets the browser. If the socket does not open, the page says: the helper is not running, or this browser blocked the localhost link. Use the phone button, or the desktop app, for in-game push-to-talk.

Chromium allows `ws://127.0.0.1` from the GitHub Pages origin. If another browser blocks it, use the phone.

The desktop app already has a global key. It does not show **Link helper**.

## Build

```bash
cd helper && cargo build --release
```

The release profile is size-focused (`opt-level = "z"`, link-time optimisation, one codegen unit, stripped, abort on panic). The window is plain Win32, so the exe stays small. `cargo test` covers the origin check, the device token, and the localhost socket. A Windows compile check is `cargo check --target x86_64-pc-windows-msvc`. This program does not need a server change.
