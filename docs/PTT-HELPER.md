# Windows push-to-talk helper

`helper/` is a small always-visible window for the web app. It is not the Electron client, and it is not a tray icon. The download today is the [helper-5 release](https://github.com/Tubss2/radio-net/releases/download/helper-5/RadioNetHelper.exe). From now on, a helper tag keeps the exe that was published on it. A newer build is a new `helper-N` tag, and the website link is updated to that tag after it exists. Those releases are separate from the desktop installer, so they are not an app update. `helper-1` was the tray build. `helper-2` was the first window build, with one key. `helper-3` was the first three-key window; its talk row was labeled PTT and the test lights were static-control colors.

It listens on `127.0.0.1:47321` only. A page may connect when its `Origin` is exactly `https://tubss2.github.io`, or `http://127.0.0.1` / `http://localhost` with any port, and its `Host` is `127.0.0.1` or `localhost`. Anything else gets HTTP 403 before the socket upgrades. A Private Network Access preflight gets `Access-Control-Allow-Private-Network` only for that same allowlist.

While nothing is linked, the window is one short row. A line of text says to enter the code under **Set up push to talk**, then **Helper app**. The code sits in that row. **Copy** puts the code on the clipboard, and the code box can be selected. The window does not open the website. The page still reads a code from the address fragment if one is already there, then removes it. The fragment is not sent to GitHub. The code is single-use.

The page sends that code once. A successful code link burns the code. The helper answers with a 32-byte device token. The page keeps that token in `localStorage` for this origin (`rn.helper`). The helper stores only the SHA-256 of the token, and the three keys, in `%APPDATA%\RadioNet\helper-device.bin`. On Windows that file is sealed with DPAPI. Later visits send the token and do not ask for a code. The pairing message does not name a key.

After the link the helper sends actions only: `{"t":"ptt","v":"down"}`, `{"t":"ptt","v":"up"}`, `{"t":"tx","v":"next"}`, and `{"t":"tx","v":"prev"}`. It does not send key codes. The page turns those into push-to-talk and into the next or previous transmit channel. The sound for a channel change stays in the web app.

The same row holds **Talk** (default **F1**), **Prev** (default **F3**), and **Next** (default **F4**). The desktop app uses those same three actions, plus F2 for the channel wheel and F5 to show or hide the overlay. **Set** on a bind waits for one key and saves it in the same file. A key can belong to only one bind. Each bind has a red light that lights while that key is held, including before the page is linked, so you can test the bind. The light is painted by the window, not by a themed static control. A status dot shows **Connected** or **Disconnected**. While a site is linked, the code and **Copy** are replaced by **Linked** and **Unlink**, and the line names that site. **Unlink** revokes the browser token and leaves the keys in place. Closing the window exits the process: Raw Input is unregistered and the socket closes. Minimising to the taskbar leaves it running. It does not start with Windows. If an older build added a Run key, this build removes it.

A script on `https://tubss2.github.io` can read `localStorage` and hold those three actions while the helper is running. Unlink revokes that. The helper file is not enough to connect, because it does not contain the token. The fragment code is the same kind of one-time secret as typing it: anyone who sees it before it is used can link once.

On Windows it uses Raw Input (`RegisterRawInputDevices` with `RIDEV_INPUTSINK`) for keyboard or mouse, and drops every event that is not one of those three binds. It does not install a low-level hook. While **Set** is waiting, the next key is the one that gets saved. Other keys are not written to the socket or to a log.

The **PTT helper** GitHub Action builds `RadioNetHelper.exe` on `windows-latest` and uploads the `RadioNetHelper` artifact. A merge to `main` publishes the next `helper-N` tag when a comment or review on that pull request starts with `Security review: approved` and the author is Tubss2, or cursor[bot] acting through the cursor app. A review that requests changes does not count. No one starts the workflow by hand. The run creates the tag with `gh release create` and writes `SHA256SUMS.txt` beside the exe. If that tag already exists, the run stops. It does not upload a new exe onto an older tag, and it does not mark the release as the repository's latest release. The tag does not start with `v`, and the job does not publish `latest.yml`. The website names one tag. Today that is https://github.com/Tubss2/radio-net/releases/download/helper-5/RadioNetHelper.exe . After a newer tag is published, update `HELPER_DOWNLOAD_URL` to that tag. Do not point it at `/releases/latest`, because that address follows whichever release is newest, including the desktop installer.

## Link it from the page

In the web app, **Set up push to talk**, then **Helper app**. The card has three steps: download, open the window, enter the code. The status line says whether it is looking for the helper, has found it, or is connected. If the window is not open, it says the helper is not running. The next time you open the radio, the page reconnects by itself if the window is still open. Change the keys with **Set** in the window. **Unlink** forgets the browser. Use the phone button, or the desktop app, for another way to talk in a game.

Chromium allows `ws://127.0.0.1` from the GitHub Pages origin. If another browser blocks it, use the phone.

The desktop app already has a global key. It does not show this helper card.

## Build

```bash
cd helper && cargo build --release
```

The release profile is size-focused (`opt-level = "z"`, link-time optimisation, one codegen unit, stripped, abort on panic). The window is plain Win32, so the exe stays small. `cargo test` covers the origin check, the device token, and the localhost socket. A Windows compile check is `cargo check --target x86_64-pc-windows-msvc`. This program does not need a server change.
