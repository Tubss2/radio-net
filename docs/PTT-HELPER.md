# Windows push-to-talk helper

`helper/` is a small always-visible window for the web app. It is not the Electron client, and it is not a tray icon. The Windows build is attached to the [helper-4 release](https://github.com/Tubss2/radio-net/releases/download/helper-4/RadioNetHelper.exe). That release is separate from the desktop installer, so it is not an app update. `helper-1` was the tray build. `helper-2` was the first window build, with one key. `helper-3` was the first three-key window; its talk row was labeled PTT and the test lights were static-control colors.

It listens on `127.0.0.1:47321` only. A page may connect when its `Origin` is exactly `https://tubss2.github.io`, or `http://127.0.0.1` / `http://localhost` with any port, and its `Host` is `127.0.0.1` or `localhost`. Anything else gets HTTP 403 before the socket upgrades. A Private Network Access preflight gets `Access-Control-Allow-Private-Network` only for that same allowlist.

While nothing is linked, the window's main content is a large pairing code and one instruction: in Radio Net, open **Set up push to talk**, then **Helper app**, and enter the code. **Open Radio Net** opens `https://tubss2.github.io/radio-net/#h=` plus that code. The code is in the fragment, so the browser does not send it to GitHub. It is single-use. The page reads it once, fills the code box, and removes it from the address bar.

The page sends that code once. A successful code link burns the code. The helper answers with a 32-byte device token. The page keeps that token in `localStorage` for this origin (`rn.helper`). The helper stores only the SHA-256 of the token, and the three keys, in `%APPDATA%\RadioNet\helper-device.bin`. On Windows that file is sealed with DPAPI. Later visits send the token and do not ask for a code. The pairing message does not name a key.

After the link the helper sends actions only: `{"t":"ptt","v":"down"}`, `{"t":"ptt","v":"up"}`, `{"t":"tx","v":"next"}`, and `{"t":"tx","v":"prev"}`. It does not send key codes. The page turns those into push-to-talk and into the next or previous transmit channel. The sound for a channel change stays in the web app.

The three rows are **Talk** (default **F1**), **Previous channel** (default **F3**), and **Next channel** (default **F4**). The desktop app uses those same three, plus F2 to show or hide the overlay and F5 for the channel wheel, so the helper does not take F2 or F5. **Set** on a row waits for one keyboard key or mouse side button (`Mouse 4` or `Mouse 5`) and saves it in the same file. A key can belong to only one row. Each row has a red light that lights while that key is held, including before the page is linked, so you can test the bind. The light is painted by the window, not by a themed static control. **Unlink** revokes the browser token and leaves the keys in place. Closing the window exits the process: Raw Input is unregistered and the socket closes. Minimising to the taskbar leaves it running. It does not start with Windows. If an older build added a Run key, this build removes it.

A script on `https://tubss2.github.io` can read `localStorage` and hold those three actions while the helper is running. Unlink revokes that. The helper file is not enough to connect, because it does not contain the token. The fragment code is the same kind of one-time secret as typing it: anyone who sees it before it is used can link once.

On Windows it uses Raw Input (`RegisterRawInputDevices` with `RIDEV_INPUTSINK`) for keyboard or mouse, and drops every event that is not one of those three binds. It does not install a low-level hook. While **Set** is waiting, the next key or side button is the one that gets saved. Other keys are not written to the socket or to a log.

The **PTT helper** GitHub Action builds `RadioNetHelper.exe` on `windows-latest` and uploads the `RadioNetHelper` artifact. It attaches that exe to the `helper-4` release only when the workflow runs on `main`. A branch push does not publish a release. Download, after that publish: https://github.com/Tubss2/radio-net/releases/download/helper-4/RadioNetHelper.exe

## Link it from the page

In the web app, **Set up push to talk**, then **Helper app**. The card has three steps: download, open the window, enter the code. The status line says whether it is looking for the helper, has found it, or is connected. If the window is not open, it says the helper is not running. The next time you open the radio, the page reconnects by itself if the window is still open. Change the keys with **Set** in the window. **Unlink** forgets the browser. Use the phone button, or the desktop app, for another way to talk in a game.

Chromium allows `ws://127.0.0.1` from the GitHub Pages origin. If another browser blocks it, use the phone.

The desktop app already has a global key. It does not show this helper card.

## Build

```bash
cd helper && cargo build --release
```

The release profile is size-focused (`opt-level = "z"`, link-time optimisation, one codegen unit, stripped, abort on panic). The window is plain Win32, so the exe stays small. `cargo test` covers the origin check, the device token, and the localhost socket. A Windows compile check is `cargo check --target x86_64-pc-windows-msvc`. This program does not need a server change.
