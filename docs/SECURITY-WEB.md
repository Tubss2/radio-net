# Web app, phone button, and the localhost helper

The desktop installer review is [`SECURITY-REVIEW.md`](SECURITY-REVIEW.md). This note is the same kind of reading for the product direction after v0.4.3: the site at `https://tubss2.github.io/radio-net/` is the radio people open, a phone can be the push-to-talk button, and a small Windows program on the gaming PC watches one key with Raw Input and tells the page over a localhost socket.

End-to-end encryption of the voice is out of scope. The server operator can still hear the radio. Say that on the join screen.

The Pages app, the phone routes, and the Rust helper are on main. The controls below are what that code has to keep. A pull request that drops one of them should not ship. The helper listens on `127.0.0.1:47321`.

## Plain English

A website is a worse place to keep an admin key than a DPAPI file. Anyone who can run script on `https://tubss2.github.io` can read `localStorage`. That includes a bug in our own page. GitHub Pages cannot set `Content-Security-Policy` or `X-Frame-Options` as real HTTP headers, so the browser will not enforce `frame-ancestors`. A meta tag can still block scripts and limit `connect-src`. It cannot stop another site from putting the radio in a frame.

The helpful part: the browser cannot install a global keylogger. Push-to-talk while the game is in front needs a separate program. That program is the new dangerous process. If it accepts a WebSocket from any website, then any tab the player has open can key the microphone. The helper has to refuse every origin except the Pages site (and localhost while developing), bind only to `127.0.0.1`, and ignore button presses until the page presents a one-time pairing secret the user can see.

A phone button is a second session with a smaller scope. The QR code is a bearer secret for a couple of minutes. After it is redeemed it must not work again. The phone token must not be an admin key and must not be a normal join session.

## Web app

| ID | Worry | Severity | What has to be true before it ships |
|---|---|---|---|
| W1 | Session token and admin key in `localStorage` | High | Session token in `sessionStorage` only. Admin key saved only if the user ticks a box, with a one-line warning and a Forget control. Invite code in `localStorage` is an accepted trade for one-click rejoin, and the join screen says so. |
| W2 | XSS on the Pages origin | High | No third-party scripts. `script-src 'self'`. No `unsafe-eval`. No inline event handlers. A stolen origin steals the token, the invite, and the admin key. |
| W3 | CSP on GitHub Pages | High for scripts, open for frames | Meta CSP is the only option Pages gives us. Pin `connect-src` to the Sydney API, the Sydney LiveKit host, and `ws://127.0.0.1:47321` for the helper. Do not use `https:` or `wss:` as a wildcard. |
| W4 | Clickjacking | Medium | `frame-ancestors` and `X-Frame-Options` are ignored in a meta tag, and Pages will not send them. An attacker page can frame the radio and overlay a fake button. Treat this as accepted on Pages, or move the app behind Caddy on the VPS where the header can be set. |
| W5 | CORS | Medium | Allow `https://tubss2.github.io`, `http://localhost` and `http://127.0.0.1` with a port, and a missing or `null` origin for the Electron `file://` build. Do not reflect other origins. This does not hide the API from a stolen bearer token. It stops a random website's JavaScript from calling it in the user's browser. |
| W6 | Microphone | Medium | Ask on a click, not on page load. Release push-to-talk on key-up, pointer-up, pointer leave, blur, and when the tab becomes hidden. A background tab must not stay on air. The track is still opened when a channel is tuned, muted until the button, same as the desktop app. Say that next to the button. |
| W7 | Mock preview at the site root | Medium | The current Pages artifact is a mock with `connect-src 'none'`. Shipping that at `/` looks like the radio and then fails every join. The mock stays on `/preview/`. The real app is a different build. |

The API does not use cookies. CORS is not the secret. The bearer token is.

LiveKit is a second origin (`wss://lk-149-28-170-200.sslip.io`). A token minted by the API is what lets the browser in. Tightening API CORS does not constrain LiveKit. Do not put the LiveKit API secret in the page.

## Phone push-to-talk (QR)

The phone is a remote button for a session that already joined on the PC or in the browser. It is not a second full client unless someone later decides it should hear audio too.

| ID | Worry | Severity | Control |
|---|---|---|---|
| PH1 | Pairing secret too short, or in a query string | High | 32 random bytes, base64url. Put it in the URL fragment (`#pair=…`), never in `?pair=`. Fragments are not sent to GitHub or to Referer. |
| PH2 | Replay | High | The server stores only the SHA-256 of the secret. Redeem is single-use and constant time. Expiry is 2 minutes. A second redeem fails. |
| PH3 | Session hijack | High | The redeemed token is scope `ptt` only: one community, one parent session, its own id, expiry of a few hours. It cannot rotate invites, delete channels, or mint an admin action. Losing the phone token keys the mic for that squad until expiry or until the parent session ends. Offer a "kick phone" control. |
| PH4 | QR photographed over a shoulder | Medium | Short expiry and single use. The QR is on screen only while pairing. |
| PH5 | Phone token used from another network | Medium | Binding to IP is fragile on mobile networks. Do not do that. Bind to the parent session epoch so an invite rotation kills the phone too. |

A malicious website that never saw the QR cannot pair. A malicious website that the user is tricked into opening from a forwarded link can, if the fragment is still intact. That is the same as forwarding a password. The page should show the community name and ask before it arms the button.

## Localhost Raw Input helper

The helper is a process on the gaming PC. It registers for keyboard and mouse with `RegisterRawInputDevices` and `RIDEV_INPUTSINK`, drops every key that is not one of the three binds (push to talk, previous channel, next channel), and speaks WebSocket on `127.0.0.1:47321` only. It does not call `SendInput`. It does not open a port on the LAN.

Raw Input still delivers every key into that process. The filter has to run before the key code is logged, stored, or written on the socket. The socket carries push-to-talk down and up, and next or previous channel. It does not carry key codes.

| ID | Worry | What a malicious website could do if we get this wrong | Control |
|---|---|---|---|
| H1 | Any origin accepted | A tab on `https://evil.example` opens the socket and holds the mic open, or times transmissions to annoy the squad. | `Origin` must be `https://tubss2.github.io` or a localhost dev origin. Missing `Origin` is a reject. Browsers send `Origin` on WebSocket handshakes. |
| H2 | DNS rebinding | Attacker DNS answers `evil.example` with `127.0.0.1`. The browser connects to loopback but the site is still the attacker's origin. | Reject on `Origin`, not on the TCP peer address. Also reject a `Host` header that is not `127.0.0.1` or `localhost`. Rebinding usually keeps the attacker's Host name; that check is the belt. The origin check is the suspenders. |
| H3 | CSRF against localhost | A public page `fetch`es `http://127.0.0.1:47321` and hopes a GET keys the radio. | No GET, POST, or query parameter changes talk state. The only command channel is the WebSocket, and it ignores input until an `auth` message with the pairing secret. |
| H4 | Private Network Access | Chrome blocks a public origin from touching loopback unless the helper answers the preflight with `Access-Control-Allow-Private-Network: true`. | Send that header, and `Access-Control-Allow-Origin`, only for an allowlisted origin. Do not send `*` . A failed preflight is what we want for every other site. |
| H5 | Pairing secret left in the page, replayed | XSS or a second tab reuses the secret and attaches its own socket. | One success burns the secret. A second socket does not get the button. The user can pair again from the helper. |
| H6 | Helper listens on `0.0.0.0` | Phones and other PCs on the LAN key the mic, or an attacker on the cafe Wi-Fi does. | Bind `127.0.0.1` only. Firewall is not the control. The bind is. |
| H7 | The process logs keys | A crash dump or a debug line becomes a key log. | The native callback prints nothing. The socket messages are the three actions, not key names. |

The Pages CSP has to list `ws://127.0.0.1:47321` and `http://127.0.0.1:47321` (the preflight). A wildcard `ws:` would let a cross-site script on our origin talk to any local port. Pin the port.

## Checklist

- [x] Session token in `sessionStorage`. Invite code may stay in `localStorage`.
- [x] Admin key in `localStorage` only if the user ticks a box, with a warning and Forget ([#21](https://github.com/Tubss2/radio-net/pull/21), on main).
- [x] Meta CSP on the real app pins Sydney and `127.0.0.1:47321`. The mock stays on `/preview/`. `connect-src 'none'` for that build is [#23](https://github.com/Tubss2/radio-net/pull/23).
- [x] API CORS allowlist includes `https://tubss2.github.io` and still allows a missing origin for Electron. Not deployed.
- [x] In-page push-to-talk releases on key-up, blur, and hidden. A phone or helper hold is allowed to keep talking when the game is in front. Voice activation waits for a click ([#23](https://github.com/Tubss2/radio-net/pull/23)).
- [x] Phone code is 32 bytes, in the URL fragment, hashed at rest, single use, two minutes ([#23](https://github.com/Tubss2/radio-net/pull/23)). The phone page waits for a tap before redeeming.
- [ ] Phone token tied to the parent session epoch, so invite rotation kills it. The epoch is [#12](https://github.com/Tubss2/radio-net/pull/12). Closing the phone dialog is the kick that exists today.
- [x] Helper binds `127.0.0.1:47321`, checks `Origin` and `Host`, answers Private Network Access only for the allowlist, and burns the pairing code after one success ([#23](https://github.com/Tubss2/radio-net/pull/23)).
- [x] Raw Input drops non-bound keys inside the callback. No `WH_*_LL` hook in this helper. The desktop Electron app still has the low-level hook.

## Decisions still with the owner

- Stay on GitHub Pages and accept clickjacking, or serve the app from Caddy so `frame-ancestors 'none'` is a real header.
- The phone that landed is button-only. It cannot publish a microphone. Leave it that way unless you explicitly want the phone to hear the radio.
- Code signing for the helper. An unsigned local EXE is the same SmartScreen problem as the desktop installer, on a smaller file.

## Where the controls landed

[#18](https://github.com/Tubss2/radio-net/pull/18), [#19](https://github.com/Tubss2/radio-net/pull/19), [#20](https://github.com/Tubss2/radio-net/pull/20), and [#22](https://github.com/Tubss2/radio-net/pull/22) are on main, via `cursor/local-callsign-keybinds-3d59`. [#15](https://github.com/Tubss2/radio-net/pull/15), [#16](https://github.com/Tubss2/radio-net/pull/16), and [#17](https://github.com/Tubss2/radio-net/pull/17) were earlier designs and are closed. The product did not use that Node helper or that HMAC pairing module.

| Control | Where it is | Still open |
|---|---|---|
| Session token in `sessionStorage` | main | Admin key is stored only when the user ticks the box ([#21](https://github.com/Tubss2/radio-net/pull/21)). |
| Pages CSP pins Sydney and port `47321` | [#23](https://github.com/Tubss2/radio-net/pull/23) | `frame-ancestors` cannot be set on GitHub Pages. |
| Mock at `/preview/` with `connect-src 'none'` | Workflow is on the product branch. The CSP meta tag is [#23](https://github.com/Tubss2/radio-net/pull/23). | None for the path. |
| API CORS allowlist | [#19](https://github.com/Tubss2/radio-net/pull/19), merged | Not deployed to Sydney. |
| Phone code, fragment, single use, data-only LiveKit grant, tap before redeem | Product branch, with the length, API host, and tap in [#23](https://github.com/Tubss2/radio-net/pull/23) | No session epoch. Redeem is a hash-map lookup. At 32 bytes that is not a practical guess. |
| Helper origin, Host, Private Network Access, one-time code, bind `127.0.0.1:47321` | Product branch plus [#23](https://github.com/Tubss2/radio-net/pull/23) | The exe is unsigned. The workflow attaches it to the `helper-3` release, which is not the desktop update feed. |
| Raw Input inside the Electron app, replacing `uiohook-napi` | Not started | The desktop hook is unchanged. The Rust helper is a separate process for the website. |
