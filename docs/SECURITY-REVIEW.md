# Security review: would I install Radio Net?

This is an outside reading of Radio Net **v0.4.3** (source commit `596d7a8` on `cursor/local-callsign-keybinds-3d59`, which is the build published as the public GitHub Release). It is the view I would write down before installing the Windows app on a PC I care about. The live Sydney server was not attacked. Later hardening changes are not in that installer until a new release is published.

## Plain English

Radio Net is a small voice-radio program for a game. The source is public, and the current code is not a hidden keylogger: it does not ship a telemetry SDK, and unbound keystrokes are not written to the log or sent to the server.

I would still not install **this** Windows build on a PC I use for banking, work email, or anything I would be unhappy for a stranger to hear.

Two facts drive that.

The program installs a low-level keyboard and mouse hook for the whole desktop while it is running. That is the same class of Windows API a keylogger uses. The current code throws away keys it does not need for push-to-talk and the channel wheel. The thing that keeps your passwords out of a file is that choice in the source, plus your trust that the copy you are running is that source. The installer is unsigned, and the app turns signature checks off so it can update itself from public GitHub Releases. If the GitHub account that publishes those releases is taken over, the next update can be a different program, including one that keeps every key.

Voice is also not private from the person who runs the server. LiveKit here is a normal selective-forwarding server. It can hear the radio. There is no end-to-end encryption.

If you still try it with friends: quit it when you are not on the radio, do not type passwords while it is open, only join a server run by someone you trust, and treat the SmartScreen warning as real. A checksum file is not published with v0.4.3, so Windows cannot tell you who built the installer.

## What would worry me

Severity is the practical risk to a person installing the public v0.4.3 build, not a theoretical score. Status is what is true **in that build today**.

| ID | What would worry me | Severity | Status in v0.4.3 | What I would do today |
|---|---|---|---|---|
| K1 | Global keyboard and mouse hook (keylogger-shaped) | High | Mitigated | Quit the app when you are not using it. Do not type passwords or recovery codes while it is open. |
| U1 | Unsigned installer, and the auto-updater skips signature checks | High | Open | Treat the download as trusted only as far as you trust the GitHub account `Tubss2` today. There is no publisher to check in Windows. |
| V1 | The server operator can hear voice | High | Open | Only join a server run by someone you trust. The public Sydney box is run by the repo owner. |
| A1 | Elytra (kernel anti-cheat) plus a global input hook and an always-on-top overlay | High for the game account | Open | Do not use this on a WARDOGS account you cannot lose. Bulkhead has not published a yes. |
| M1 | Microphone is opened when you tune, not only while you talk | Medium | Open | Untune when you leave the radio. A Windows microphone indicator means the device is open. |
| O1 | Always-on-top, click-through overlay | Medium | Mitigated | It is a separate window, not a draw inside the game. F10 hides the talker list. It can still look like a cheat overlay to anti-cheat. |
| N1 | The server sees your IP, callsign, and which channels you tune | Medium | Open | Inherent once you connect. The operator also keeps Caddy access logs. |
| I1 | The invite code is the whole login. A callsign is not an identity. | Medium | Mitigated | Do not post the invite in public. Anyone with it can join and pick any callsign, including yours. Rotating the invite does not end sessions that are already open (they last up to 12 hours). |
| L1 | Admin key and session token stored on the PC | Medium | Mitigated | On a normal Windows PC the profile is encrypted with DPAPI (`safeStorage`). If OS encryption is unavailable the same file is written in the clear. Do not copy the profile folder onto a shared disk. |
| C1 | Electron window is only partly hardened | Medium | Partial | `contextIsolation` is on and the preload bridge is small. The renderer sandbox is off, navigation is not blocked, and the CSP allows a connection to any `https:` or `wss:` host (so a community can live on its own server). |
| R1 | Community admin key is a bearer password | Medium | Mitigated | It is hashed on the server (SHA-256) and compared in constant time. Whoever has the key can delete the community. There is no second factor. |
| D1 | Dependencies, Actions, and the release pipeline | Medium | Open | The repo is public, which helps a reader. Actions are pinned by floating tags (`@v4`), not by commit. There is no CodeQL workflow in the repo. `npm` lockfiles exist. |
| S1 | A forgotten dev seed would publish a known invite and admin key | High if a server is mis-set | Mitigated in the deploy kit | `deploy/setup.sh` sets `SEED_DEV=0` and generates a setup code. The public dev invite `DEVN-ET01` / admin key `rnk_dev` is in the repo on purpose for local development. Do not point the app at a server that was started with the defaults. |
| G1 | Logs | Low | Partial | The client log stays under the Electron user-data folder, rotates, and strips `Bearer` tokens and `rnk_` admin keys. The API journal line is method, path, status, and time. Caddy's JSON access log is not configured to drop `Authorization` or `X-Admin-Key`. |
| T1 | Telemetry | Low | Fixed | No analytics SDK, no crash reporter, no phone-home beyond the server you join and the GitHub update check. |
| P1 | The repo is public | Low for secrecy, medium for the release account | Open | Anyone can read the client. Anyone who can publish a Release on `Tubss2/radio-net` can ship a build the app will install. |

## The hook (K1)

`uiohook-napi` starts a global low-level keyboard hook and a global low-level mouse hook when the app is ready, and stops them when the app quits (`spike/client/src/main/hotkeys.ts`). The callback runs for every key and mouse button, not only the ones you bound.

What the current code does with that stream:

- It emits push-to-talk, the wheel key, the overlay key, the cycle key, and any per-channel binds.
- While the wheel key is held it also emits digit keys, so you can pick a slot.
- It emits Escape on every key-down, including when the channel wheel is closed.
- It emits vertical scroll while the wheel is open or the wheel key is held.
- It remembers every key that is currently down, in a set in the main process, so key-repeat does not fire twice.
- It does not write key codes to `radio-net.log`. The log lines for the hook are `hotkeys start` and `hotkeys stop`.
- It does not send unbound keys to the renderer, and the renderer does not send them to the API.

That is a real filter. It is not a guarantee. The native hook has already seen the key before JavaScript drops it. A memory dump of the process can see the codes of keys that are held down. A replaced `hotkeys.ts` in a later update can keep them. There is no on-screen indicator that the hook is installed, and there is no button to unhook without quitting.

Windows does not offer an API that delivers only "Mouse 4" and "F2" to an unelevated app while also letting the game see those same buttons. `RegisterHotKey` can watch a shortcut and it consumes the key, so the game would not see it. Raw Input (`RegisterRawInputDevices` with `RIDEV_INPUTSINK`) is the better long-term design: it is not a `WH_*_LL` hook in the input chain, which matters for latency and for anti-cheat heuristics, but the process still receives the other keys and must drop them. A small native addon can drop them before the code reaches JavaScript. That addon is not in v0.4.3. The design notes already in [`anticheat-and-contacts.md`](anticheat-and-contacts.md) match this.

The hook also fails open in one direction that is easy to miss: if the game runs as administrator and Radio Net does not, Windows hides that game's input from the hook. The app does not work around that by asking for admin. That is the right choice. An admin copy of this hook would be worse.

## The installer and the updater (U1)

`spike/client/package.json` sets `win.verifyUpdateCodeSignature` to `false`. `spike/client/src/main/updater.ts` replaces `verifyUpdateCodeSignature` with a function that returns `null`, which electron-updater treats as "signature check passed". The feed is the public GitHub Releases page for `Tubss2/radio-net`. On startup, and every four hours, a packaged app checks that feed, downloads in the background, and then asks you to restart.

electron-updater still checks the SHA-512 published in `latest.yml` against the downloaded file. That catches a corrupted download. It does not catch a hostile release, because the person who can replace the installer can replace `latest.yml` in the same release. Authenticode is what would make that harder. There is no certificate, so SmartScreen has no publisher to learn.

What this costs, when you decide to sign later:

- A standard (OV) code-signing certificate is on the order of US$200–400 a year. SmartScreen reputation builds slowly, so users still see a warning at first.
- An EV certificate is on the order of US$300–700 a year, usually with a hardware token or a cloud HSM. Reputation arrives faster. electron-builder can use one.
- Azure Artifact Signing (Trusted Signing) is about US$10 a month and fits a short-lived CI cert, and it expects an organization Microsoft can verify. A solo hobby account is often the awkward case.

Until one of those is in place, a cautious user is trusting a GitHub login. I would also publish a `SHA256SUMS` file beside the installer and stop downloading updates until the user asks. Neither of those is in v0.4.3.

## The overlay (O1)

The overlay is a transparent, frameless, always-on-top, click-through window. It is created by Electron, not by injecting a DLL into WARDOGS. Clicks pass through to the game except while the channel wheel is open, when the window takes focus so the wheel can be used. That focus steal is visible: the game loses the keyboard until the wheel closes.

It does not capture the screen and it does not read pixels from the game. The worry is appearance and anti-cheat heuristics, plus a window that can sit above other programs for as long as the app is running. The talker list can be hidden with the overlay bind (default F10). The process keeps running.

## The microphone (M1)

Tuning a channel you are allowed to talk on calls `createLocalAudioTrack` and publishes that track into the LiveKit room, then mutes the publication (`spike/client/src/renderer/src/lib/radioEngine.ts`). Holding push-to-talk unmutes it. Releasing mutes it again.

So:

- The operating system shows the microphone as in use for the whole time you are tuned to a channel you can transmit on.
- Audio is supposed to go to the server only while the publication is unmuted.
- A bug in that mute path, or a modified client, can talk without the user holding the key. The server allows publish on every tuned channel the user may talk on, so switching channel is instant. "Only one channel at a time" is enforced in the client, not by the server.

There is no setting in v0.4.3 to open the device only for the length of a transmission. That would add a little delay at the start of each call. It would also match what people assume "push to talk" means.

## What leaves the PC, and where it goes

| Data | Where it goes | When |
|---|---|---|
| Invite code, callsign | The API host you join (the installer default is `https://radio-149-28-170-200.sslip.io`) | Join |
| Admin key | That same API, in the `X-Admin-Key` header | Create channel, delete, rotate invite, delete community |
| Channel ids you want tokens for | That API | Tune |
| Voice, and a muted mic track | LiveKit on the same VPS (`wss://lk-149-28-170-200.sslip.io` in the default build) | While tuned; audio while push-to-talk is held |
| Your IP address | The VPS, the kernel, and Caddy's access log | Every connection |
| Update check | `github.com` releases for `Tubss2/radio-net` | Startup and every four hours, packaged app only |
| Keystrokes other than the binds above | Nowhere | Dropped in the main process |
| Profile file, local log | Disk on this PC | Saved locally |

The app does not embed a Discord token, a product-analytics key, or a crash-upload URL.

## Who runs the server, and what they can see (V1, N1)

The deploy kit is written for one Ubuntu VPS. The copy described in `deploy/README.md` is a Vultr Sydney VM at `149.28.170.200`, operated by the repository owner. Caddy terminates HTTPS. The API and LiveKit listen on localhost. The firewall is intended to allow SSH, HTTP, HTTPS, LiveKit TCP 7881, and LiveKit UDP 7882.

The operator can see:

- Source IP, time, path, and status. Caddy writes a JSON access log. The API adds a journal line without the token or the admin key.
- Everything in `/var/lib/radionet/store.json`: community names, invite codes, channel names and frequencies, and the SHA-256 of each admin key. The file has no integrity MAC, so anyone who can write it can edit the community. On the VPS that is the `radionet` service user and root.
- Voice. LiveKit decrypts media for a normal SFU. The API secret that signs LiveKit tokens is on that box (`/etc/radionet/secrets.env`). There is no end-to-end encryption layer in the client.

They cannot see your Windows password from the server. They never receive the unbound key stream, because the client does not send it. They can rotate a lost admin key if they have the server setup code, which is generated once into `secrets.env`.

A malicious or compromised server can also hand the client a LiveKit URL and tokens. The client uses the URL the API returns (`resolveLivekitUrl` falls back to the build-time URL). Pointing the app at a server you do not trust is pointing your microphone at that server.

## Invite codes and local keys (I1, L1, R1)

There is no account. Joining sends an invite code and a callsign and gets back an HMAC session token that lasts 12 hours. The token is not stored on the server, so it cannot be revoked individually. The signing secret is the LiveKit API secret. A stolen server secret forges sessions and voice tokens.

Invite codes are 8 characters from a 31-character alphabet (`spike/server/src/accounts.ts`), and joins are limited (30 per minute per IP in the deploy kit, 10 per minute if the env var is unset). Guessing one online is not a practical attack. Sharing one is the whole membership check.

The admin key is `rnk_` plus 32 random bytes, shown once, and stored in the local profile. The server stores only SHA-256. Comparison uses `timingSafeEqual`. The setup code that can replace a lost admin key is compared with ordinary string inequality, and community creation is rate-limited per IP.

The profile is `profile.bin` under Electron user data. When `safeStorage` can encrypt, that is DPAPI on Windows. The file mode is `0600` (meaningful on Unix; Windows uses ACLs). The same function writes the JSON in the clear when encryption is unavailable, admin key included.

## Dependencies and the public repo (D1, P1)

The client depends on Electron, `uiohook-napi` (a native module), `electron-updater`, `livekit-client`, and React. The server depends on Fastify, `@fastify/cors`, Zod, and `livekit-server-sdk`. Lockfiles are committed. A native hook module is a larger supply-chain bet than a pure JS library, because it runs outside the JS sandbox with the user's privileges.

The GitHub Actions workflows check out code with `actions/checkout@v4` and, for the installer, use `contents: write` so they can publish a Release. Tag pinning follows the moving `v4` branch tip. A compromised action tag is a path to a malicious installer. The workflow also refuses to build if `RN_FAKE_MEDIA` is set, and it checks that `app-update.yml` names `Tubss2/radio-net` and contains no token. Those checks are good. They run inside the workflow an attacker who can edit the workflow can change.

Publishing the source is a plus. A reader can do what this review did.

## Anti-cheat (A1)

WARDOGS ships Elytra, a kernel anti-cheat, and the public privacy notes for the game also name an Anybrain SDK that collects keyboard and mouse telemetry. Radio Net does not open the game process, does not write the game's files, and does not send input into the game. The hook only observes. The overlay is a normal top-level window.

That is still the pattern anti-cheat products look at: a global hook, plus a window stuck above the game. [`docs/anticheat-and-contacts.md`](anticheat-and-contacts.md) already says this and ranks Raw Input as the lower-risk replacement. No whitelist from Bulkhead is in the repo. A false ban here is often a hardware ban. I would not be the first volunteer on a main account.

## Smaller holes I would still fix

These are below the "would I install it" line and still real:

- The join rate-limit map grows with every IP and is never pruned (a slow memory leak under a scan).
- CORS on the published v0.4.3 server reflects any browser `Origin`. The API uses bearer tokens, not cookies, so a random website still needs the token. The product branch allowlists `https://tubss2.github.io` and localhost instead. That allowlist is not on the live Sydney API until someone deploys it.
- Production safety depends on env vars. The process will boot with API secret `secret` and seed `DEVN-ET01` if you forget `SEED_DEV=0`. The deploy kit does not forget. A hand-run `npm start` on a public port would.
- SSH in the cloud-init file installs one deploy key and a firewall. `setup.sh` does not install fail2ban, does not turn on unattended upgrades itself (cloud-init does, on first boot), and does not set `PasswordAuthentication no`.
- The three services share the `radionet` user. systemd already sets `NoNewPrivileges`, `ProtectSystem=strict`, and `ProtectHome`. That is a decent baseline, not a split between the voice server and the API.

## What a cautious user should do today

1. Skip v0.4.3 on any PC where a keylogger or a swapped update would be a serious problem.
2. If you run it anyway, quit it when you stand up from the radio. The hook lives until the process exits.
3. Only join the server you meant to join. The person who runs it can hear you and can see your IP and callsign.
4. Keep the admin key like a password. It is on that PC, in the profile.
5. Do not use your main WARDOGS account until Bulkhead has said this kind of companion is acceptable.
6. Prefer a build you watched compile, or wait for a release that is code-signed and that publishes a checksum. The SmartScreen "Run anyway" step is the unsigned-file warning, not a formality.

## What I would want before I changed my mind

In order:

1. Code signing, and the updater refusing a build that does not verify. Until the certificate exists: do not download an update until the user asks, pin the feed to `Tubss2/radio-net`, and publish SHA-256 checksums.
2. The hook starts only after a first-run explanation, watches only the bound keys (drop everything else before it is stored), can be paused from the window, and shows that state all the time. Raw Input instead of a low-level hook when someone writes the small Windows addon.
3. Electron sandbox on, navigation and extra windows denied, IPC checked, camera denied, secrets left out of the profile when DPAPI is missing.
4. Invite rotation ends existing sessions. Store file integrity. Security headers, bounded rate limits, constant-time setup-code compare, production boot refuses the dev secret.
5. Actions pinned by commit SHA, `GITHUB_TOKEN` limited to the job that publishes, Dependabot, CodeQL, and secret scanning. fail2ban, key-only SSH, unattended upgrades, on the VPS when the owner next runs setup.

## Follow-up work (not in the v0.4.3 installer)

The ratings above are the published installer. Later pull requests change the source. They do not change what a person downloads today.

| Pull request | What it does | Still open after it |
|---|---|---|
| [#11](https://github.com/Tubss2/radio-net/pull/11) | Sandbox on, navigation and extra windows denied, IPC checked, camera denied. Hook starts after a first-run screen, drops unbound keys before storing them, and can be paused. Secrets are omitted from the profile when DPAPI is missing. Updates are not downloaded until the user clicks, and the feed is pinned to `Tubss2/radio-net`. | Authenticode is still skipped. Raw Input is not built. The microphone still opens when you tune. |
| [#12](https://github.com/Tubss2/radio-net/pull/12) | Invite rotation ends open sessions. Setup-code compare is constant time. Rate-limit memory is capped. Production boot refuses the dev seed and the dev LiveKit secret. `store.json` is mode `0600` and can take an HMAC. Security headers. CORS no longer reflects arbitrary websites. | Voice is still not end-to-end encrypted. The live VPS does not have this code until it is deployed. |
| [#13](https://github.com/Tubss2/radio-net/pull/13) | Actions pinned by commit. Release job is the one with `contents: write`. `SHA256SUMS.txt` on the next published release. Dependabot, CodeQL, gitleaks. `setup.sh` adds fail2ban, key-only SSH, unattended upgrades, header-free Caddy logs, and `RN_STORE_MAC_KEY`. | A checksum does not name a publisher. The Sydney box has not been re-run. |
| [#14](https://github.com/Tubss2/radio-net/pull/14) | Threat model for the Pages app, the phone button, and the localhost helper. | The controls themselves are in the pull requests below. The helper port in that note was `47391`. The program that landed listens on `47321`. |
| [#21](https://github.com/Tubss2/radio-net/pull/21) | Admin key stays out of `localStorage` unless the user ticks a box, with Forget. | Every repository on `https://tubss2.github.io` shares one origin. A key the user chooses to keep is readable by another Pages site on that account. |
| [#23](https://github.com/Tubss2/radio-net/pull/23) | Helper code burns after one successful link. `Host` must be loopback. Private Network Access is not `*`. Pages CSP pins port `47321`. Phone codes are 32 bytes. A rewritten API host is ignored. Voice activation waits for a click. The phone does not redeem until a tap. The mock preview build gets `connect-src 'none'`. | No session epoch, so invite rotation does not kill a phone token that was already issued. Clickjacking is still open on Pages. The helper exe is unsigned. |

[#15](https://github.com/Tubss2/radio-net/pull/15), [#16](https://github.com/Tubss2/radio-net/pull/16), and [#17](https://github.com/Tubss2/radio-net/pull/17) were earlier designs. The product branch shipped its own web app, Rust helper, and phone routes. Those three are closed so they are not a second copy of the same work.

## Web app, phone button, and helper

These rows are the product branch (`cursor/local-callsign-keybinds-3d59`), not the v0.4.3 installer. Nothing here has been deployed to Sydney, and no release was published.

| ID | Worry | Severity | Status |
|---|---|---|---|
| W1 | Session token and admin key in `localStorage` | High | Partial. The session token is in `sessionStorage`. The admin key is still written to `localStorage` until [#21](https://github.com/Tubss2/radio-net/pull/21). |
| W2 | XSS on the Pages origin | High | Mitigated in source. `script-src 'self'`, no `unsafe-eval`. The QR image is an SVG from our own URL. |
| W3 | CSP connect targets | High | Fixed in [#23](https://github.com/Tubss2/radio-net/pull/23) for the source. Sydney API, Sydney LiveKit, and `127.0.0.1:47321` only. `frame-ancestors` is not in the meta tag, because a meta tag cannot enforce it. |
| W4 | Clickjacking | Medium | Open. Accepted while the app stays on GitHub Pages, or closed by serving it from Caddy. |
| W5 | CORS | Medium | Fixed on the product branch ([#19](https://github.com/Tubss2/radio-net/pull/19)). Not deployed. |
| W6 | Microphone on page load | Medium | Fixed in [#23](https://github.com/Tubss2/radio-net/pull/23) for voice activation. Hold-to-talk was already a key or button press. Tuning a channel still opens the mic and leaves it muted, same as the desktop app. |
| W7 | Mock preview at the site root | Medium | Mitigated. The workflow publishes the real app at `/radio-net/` and the mock under `/preview/`. [#23](https://github.com/Tubss2/radio-net/pull/23) sets the preview build to `connect-src 'none'`. |
| PH1 | Pairing secret length and placement | High | Fixed in [#23](https://github.com/Tubss2/radio-net/pull/23). 32 random bytes, in the URL fragment. |
| PH2 | Replay | High | Mitigated. SHA-256 at rest, single use, two minutes. Lookup is a hash map, not a byte-by-byte scan. At 32 bytes that does not help an attacker guess the code. |
| PH3 | Phone token scope | High | Mitigated. Redeem returns a data-only LiveKit token, not an API session. The phone cannot publish a microphone. Closing the phone dialog drops the button. There is no session epoch until [#12](https://github.com/Tubss2/radio-net/pull/12). |
| PH4 | Forwarded link arms the button | Medium | Fixed in [#23](https://github.com/Tubss2/radio-net/pull/23). The page waits for a tap before it redeems the code. |
| H1 | Helper accepts any website | High | Fixed on the product branch. `Origin` must be the Pages site or localhost. |
| H2 | DNS rebinding | High | Fixed in [#23](https://github.com/Tubss2/radio-net/pull/23). `Host` must be `127.0.0.1` or `localhost`. |
| H3 | A GET to localhost keys the radio | High | Fixed on the product branch. Talk state changes only after the WebSocket pair message. |
| H4 | Private Network Access for every site | High | Fixed in [#23](https://github.com/Tubss2/radio-net/pull/23). The preflight header is the exact allowlisted origin, never `*`. |
| H5 | Pairing code reused for the life of the helper | High | Fixed in [#23](https://github.com/Tubss2/radio-net/pull/23). One success burns the 12-character code. |
| H6 | Helper listens on the LAN | High | Fixed on the product branch. Bind is `127.0.0.1:47321` only. |
| H7 | Helper logs other keys | High | Fixed on the product branch. Raw Input drops every key that is not the watched one, before anything is written to the socket. The callback does not print key codes. |

`npm audit` on the client production tree is clean. The high and critical counts are in dev tooling (the installer toolchain). Dependabot is the ongoing watch for those. The server tree is clean.
