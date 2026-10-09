# Radio Net threat model

This is the model the hardening work is written against. The user-facing assessment of the v0.4.3 installer is [`SECURITY-REVIEW.md`](SECURITY-REVIEW.md). What the app reads and where it sends it is [`PRIVACY.md`](PRIVACY.md). The GitHub Pages app, the phone button, and the localhost helper are [`SECURITY-WEB.md`](SECURITY-WEB.md).

## Assets

| Asset | Where it lives | Why it matters |
|---|---|---|
| Voice | LiveKit on the community VPS, in memory on each client | Squad comms. The SFU can hear them. There is no end-to-end encryption. |
| Callsign | Client profile, session token, LiveKit participant name | People treat it as an identity. It is not authenticated. |
| Invite code | Server `store.json`, client profile, whoever the admin told | Possession is membership. |
| Community admin key | Client profile (plaintext only at the moment it is shown, then inside the profile file). Server stores SHA-256. | Create and delete channels, rotate the invite, delete the community. |
| Server setup code | `/etc/radionet/secrets.env` on the VPS | Create communities and replace a lost admin key. |
| Session token | Client profile, `Authorization` header. HMAC, 12 hours, not stored server-side. | Act as a member of one community. |
| LiveKit API secret | VPS secrets file, also the HMAC key for session tokens | Forge voice grants and session tokens. |
| Keystrokes and mouse buttons | Inside the client process while the hook is running | Passwords, chat, the game itself. |
| Microphone | OS capture device while a transmittable channel is tuned | Anything said in the room, muted or not, if the mute path fails. |
| Player IP address | VPS connection tables and Caddy logs | Ties a person to a callsign. |
| GitHub release artifacts | Public Releases, consumed by electron-updater | The next version of the app, running as the user. |
| `store.json` | `/var/lib/radionet/store.json` | Every community, invite, channel, and admin-key hash. |

## Attackers

**Malicious community member.** Has a valid invite, or stole one. Can join under any callsign, hear every channel they can tune, and talk on channels the server marks as transmittable. They cannot mint admin actions without the admin key. They can annoy, impersonate, and fill the rate limit. They cannot read other people's profile files.

**Random internet attacker.** Can reach HTTPS on the VPS and the LiveKit media ports. Wants to guess an invite, guess the setup code, scrape the API, or knock the process over. Invite entropy and the per-IP join limit are the current brake. The setup code is high entropy in the deploy kit and is compared with ordinary string equality in v0.4.3. The API has no account lockout beyond that rate limit.

**Compromised GitHub account or a compromised release.** Can publish a new `latest.yml` and installer. The v0.4.3 client will download it and, after the user clicks Restart, run it. SHA-512 in `latest.yml` does not help, because the attacker writes both files. This is the path from "public repo" to "keylogger on every player's PC".

**Network attacker (MITM).** The client speaks HTTPS and WSS to hostnames that Caddy certifies with Let's Encrypt. A MITM who cannot forge those certificates does not see the bearer token or the voice. A MITM who can (a machine that installed a local root, or a user who clicks through a certificate warning) sees both. The desktop app does not pin the certificate or the public key. Update downloads are HTTPS to GitHub.

**Malicious or compromised server.** The user typed the URL, or the API returned a LiveKit URL. That operator sees IPs, callsigns, channel membership, invite codes, and voice. They can hand out tokens that let a modified client publish. Users who point Radio Net at a third-party server are trusting that server with the microphone.

**Local attacker on the PC.** Can read the process, the hook's view of the keyboard, and the profile file if they are the same user. DPAPI stops a copy of `profile.bin` from being useful on another Windows account. It does not stop malware already running as the user. An unsigned auto-update is how that malware arrives.

**Anti-cheat and the game vendor.** Not trying to steal data. Trying to decide if this process is a cheat. A global hook and a topmost overlay are the signals. A wrong decision costs the player an account. See [`anticheat-and-contacts.md`](anticheat-and-contacts.md).

## Trust boundaries

```
[keyboard / mouse] --low-level hook--> [Electron main process]
                                              |
                                              | IPC (preload bridge)
                                              v
                                       [Chromium renderer]
                                              |
                         HTTPS bearer / admin key / WSS voice
                                              |
                                              v
                                       [Caddy on the VPS]
                                         /            \
                                        v              v
                                 [Radio Net API]   [LiveKit SFU]
                                        |
                                        v
                                   [store.json]
```

- The renderer is treated as able to call only the preload API. v0.4.3 turns on `contextIsolation` and leaves the sandbox off. Node is not integrated into the page. The preload exposes profile, keybinds, overlay, wheel, update, and a log line.
- The main process is fully privileged as the user. The hook lives there. Secrets are encrypted there with `safeStorage` when the OS allows it.
- The API trusts a valid HMAC more than it trusts the caller. It does not keep a session table, so logout is "wait 12 hours" or "change the signing secret" (which also breaks LiveKit).
- LiveKit trusts tokens the API signed with the shared secret. Grants in v0.4.3 are room-scoped, subscribe plus microphone publish, no data channel, no metadata edits. They are not end-to-end encrypted.
- Caddy is the only public HTTP listener. The API binds to localhost in the deploy kit. `TRUST_PROXY=1` means the API believes `X-Forwarded-For` from that local proxy. If the API is ever exposed directly, clients can spoof the rate-limit IP.
- GitHub Releases are outside the VPS. The client trusts them for code.

## What we are willing to accept

- A community member can hear channels they were invited to hear.
- The server operator can hear voice and see IPs. Publishing that clearly is the mitigation. End-to-end encryption is a different product.
- Push-to-talk needs some global input signal on Windows. The mitigation is to drop every event that is not a bound key, keep the hook off until the user has seen that fact, and make the hook easy to remove. Replacing the low-level hook with Raw Input is the anti-cheat mitigation, and it still discards unwanted keys inside the process.
- The connect-src CSP allows any `https:` and `wss:` host, because each community can name its own server. Script, frame, and object sources stay on the app.

## What we are not willing to accept

- Unbound keystrokes written to disk, sent to a server, or kept in a list.
- An update installed from anywhere other than the pinned GitHub repository, or installed with signature checks skipped once a certificate exists.
- The dev invite and the dev API secret on a public server.
- Admin keys or session tokens in logs.
- The camera, extra windows, or navigation from the renderer to a website.

## Input hook design (Raw Input)

v0.4.3 uses `uiohook-napi` (`SetWindowsHookEx` `WH_KEYBOARD_LL` and `WH_MOUSE_LL` via libuiohook). The replacement, when someone builds it:

1. A Windows-only N-API addon registers for keyboard and mouse with `RegisterRawInputDevices` and `RIDEV_INPUTSINK`, owned by a hidden message window in the main process.
2. The native callback compares the virtual key or the mouse button to the bound set. Escape and digit keys are included only while the channel wheel is open. Everything else is discarded before it is copied into JavaScript. Scroll is forwarded only while the wheel is open.
3. The addon does not call `SendInput` and does not swallow the event. The game still sees the button.
4. `uiohook-napi` stays as a fallback for the Linux dev box and for the period before the addon ships. The same discard rules apply in JavaScript, which is a weaker place to apply them (the key has already entered the JS heap).
5. The hook or the Raw Input registration is created only after the first-run notice, and only while keybinds are enabled. Quitting the app removes it.

Raw Input still delivers every key to the process. The gain is that the filter can live in native code, and the app is no longer inserted as a low-level hook in the system input chain. `RegisterHotKey` is the only common API that subscribes to a single shortcut, and it eats the key, so it is a poor fit for a mouse button the game also needs.

## Updater and code signing

The feed is hard-coded to `provider: github`, owner `Tubss2`, repo `radio-net`. v0.4.3 disables Authenticode checks because the installer is unsigned.

Decision the owner still has to make: pay for a certificate (see the cost notes in [`SECURITY-REVIEW.md`](SECURITY-REVIEW.md)). After a cert exists, remove `verifyUpdateCodeSignature: false`, remove the runtime skip in `updater.ts`, and set `publisherName` to the certificate subject. Until then, publish `SHA256SUMS` next to the installer, and download an update only after the user asks.

## Deploy assumptions

The VPS is a single Ubuntu box administered by SSH with the deploy key in `cloud-init.yaml`. Root can log in with that key. The app user is `radionet`, which runs LiveKit, the API, and Caddy. Secrets are mode `0640`, group `radionet`. Re-running `setup.sh` is how this box picks up firewall, fail2ban, and SSH changes. This document does not itself change the live server.

## Web app, phone button, localhost helper

The primary client after v0.4.3 is the site on GitHub Pages, plus a phone used as a push-to-talk button and a small Windows helper that watches one key with Raw Input. The assets above still apply. New ones:

| Asset | Where it lives | Why it matters |
|---|---|---|
| Browser session token | `sessionStorage` on `tubss2.github.io` | Same power as the desktop session token, readable by any script on that origin. |
| Browser admin key | `localStorage` only if the user opts in | Full community admin, in a place XSS can read. |
| Phone pairing secret | QR fragment, SHA-256 on the server | Redeems a `ptt`-scoped token for one parent session. |
| Helper pairing secret | Shown by the helper, sent once on the socket | Authorises one page to receive talk up/down. |

A malicious website is a new attacker. It cannot install a global hook from the page. It can try to open `ws://127.0.0.1:47391` and key the microphone if the helper accepts its origin, and it can frame the Pages app because GitHub Pages will not send `frame-ancestors`. The controls, and what a bad helper would let that site do, are in [`SECURITY-WEB.md`](SECURITY-WEB.md). End-to-end voice encryption stays out of scope.
