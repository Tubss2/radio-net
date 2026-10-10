# Security audit: main at v0.4.5 (10 Oct 2026)

This is a full read of `main` at `2d10563` (desktop v0.4.5, helper `helper-5`, the Pages web app, the Sydney API), plus a few harmless checks against the live services. It checks the claims in [`SECURITY.md`](SECURITY.md), [`SECURITY-WEB.md`](SECURITY-WEB.md), and [`SECURITY-REVIEW.md`](SECURITY-REVIEW.md) against the code, lists the gaps that are still open, looks at the planned work (device identity in PR #51, a domain, code signing, Raw Input on the desktop), and ends with what a person downloading each app should know.

No exploit was run against the live server. The live checks were: response headers, a CORS preflight from a foreign origin, a bogus phone code, the dev invite, the SSH auth methods on offer, and whether ports 7880 and 8787 answer from outside.

## Plain English

Most of the hard work already landed and holds up. The API is careful, the helper is well fenced, the Electron window is locked down, and the live server matches the hardened code.

The biggest remaining risk is not in the app code. It is **who and what can publish a GitHub Release**, because the desktop app offers to install whatever is marked Latest, with no signature check. Today that set is larger than "Tobias": the installer workflow runs `npm ci` with a write-capable token on every push to every branch, and `helper-5` was published by the Cursor bot instead of the approval workflow. That is the first thing to close.

The second is **names**. Every URL the apps trust is `*.sslip.io` built from the VPS IP, and the web app shares the `https://tubss2.github.io` origin with a second live site. Buying the domain that is already on the plan fixes both, if the move is done in the right order.

## What was verified live

| Check | Result |
|---|---|
| API security headers (`nosniff`, `X-Frame-Options: DENY`, `no-referrer`, `no-store`) | Present. The hardened API is deployed. |
| CORS preflight from `https://evil.example` | No `Access-Control-Allow-Origin`. The allowlist is live. |
| `POST /api/phone/redeem` with a bogus code | `404 That pairing code is not valid`. Phone routes are live. |
| `POST /api/join` with `DEVN-ET01` | Rejected. No dev seed on the server. |
| SSH auth methods | `publickey` only. The password hot-fix held. |
| TCP 7880 (LiveKit HTTP) and 8787 (API) from outside | Closed. Only Caddy is public. |
| HSTS on the API host | Not sent. |
| Second site on `https://tubss2.github.io` | `ReforgerArtyCalc` is live on the same origin. |
| Release authors | `v0.4.5` and `helper-4` by `github-actions[bot]`. `helper-5` by `cursor[bot]`. |
| Repository rulesets | None. Branch protection could not be read with this token. |

## Findings

Severity is the practical risk to people using the apps, not a CVSS score.

### High

**A1. The installer workflow gives every branch push a token that can publish a release.**
`.github/workflows/windows-installer.yml` runs on `push` to any branch. The whole `installer` job has `contents: write`. `actions/checkout` keeps that token in `.git/config` by default, and the same job then runs `npm ci` and `npm run dist:win`, which execute install scripts from the full client dependency tree. A compromised npm package, or a malicious commit on any branch, can read the token and create a `v9.9.9` release marked Latest. Installed desktop apps check that feed every four hours and skip the signature check. The user still has to click Download and Restart, but the prompt looks like a normal update.
*Fix:* split the job. The build job gets `contents: read`, `persist-credentials: false`, and runs on every push. A separate publish job runs only for a `v*` tag, downloads the artifact, does not run `npm`, and holds `contents: write`. Put that job behind a GitHub environment (`release`) with Tobias as the required reviewer. The [`SECURITY-REVIEW.md`](SECURITY-REVIEW.md) row for #13 says the release job is the only one with write access. That holds for the helper workflow but not for the installer.

**A2. More than one actor can ship code to desktop users.**
`helper-5` was created by `cursor[bot]`, not by the `publish-new-helper` workflow. That means the Cursor GitHub App installation can create tags and releases. There are no repository rulesets. Anything that can create a `v*` release can reach every desktop install, as described in A1. Security review of agent PRs is posted as PR comments, so nothing on GitHub enforces it.
*Fix:* add a tag ruleset so only the release workflow (or Tobias) can create `v*` and `helper-*` tags. Add branch protection on `main` that requires a pull request. Put the publish jobs behind the `release` environment. Make sure Tobias's GitHub account uses a passkey or hardware key. Tell agents in writing that they must never create tags or releases.

**A3. TLS trust rests on sslip.io and on keeping the VPS IP.**
The API, LiveKit, the Pages CSP, `allowedPhoneApi`, and the URLs baked into the installer are all `radio-149-28-170-200.sslip.io` and `lk-149-28-170-200.sslip.io`. Whoever controls sslip.io's DNS, or whoever is given `149.28.170.200` after the VPS is destroyed, can get a valid Let's Encrypt certificate for those names. That party sees session tokens, admin keys sent in `X-Admin-Key`, and voice. Installers already out there keep trusting those names.
*Fix:* the domain is already on the plan (`naming.md`). Add a CAA record that names Let's Encrypt. Plan the move in the order in the "Moving to a domain" section below.

### Medium

**B1. Rotating the invite does not remove anyone from voice.**
Rotation bumps `sessionEpoch`, so API calls with old tokens fail. Nothing calls LiveKit `RemoveParticipant` or deletes the rooms. A connected client stays in every channel it is tuned to, and LiveKit refreshes tokens for connected participants. So the only "kick" that exists today does not kick an eavesdropper who is already in. There is no per-person kick at all.
*Fix (now):* on `invite/rotate`, delete every room of the community, as delete-channel already does. Everyone reconnects, and the people with the new code get back in. *Fix (later):* the device revoke in PR #51 has to remove participants, and it should treat that call as required, not best-effort.

**B2. A misconfigured production boot writes the public dev community to disk.**
`spike/server/src/index.ts` seeds `DEVN-ET01` with admin key `rnk_dev` before it calls `assertProductionConfig`. With `NODE_ENV=production`, `RN_DATA_FILE` set, and `SEED_DEV` forgotten, the process refuses to boot but `store.json` already holds the dev community. The next boot with `SEED_DEV=0` serves it, with an admin key that is in the repo. This was reproduced locally. The deploy kit sets `SEED_DEV=0`, so Sydney is not affected today.
*Fix:* call `assertProductionConfig` before the seed block.

**B3. The shared Pages origin is a live risk, not only a theoretical one.**
`https://tubss2.github.io/ReforgerArtyCalc/` is served from the same origin as the radio. Today it loads only its own `main.js`. Any future change to that repo, any dependency it adds, or any new Pages repo on the account can read the radio's `localStorage`: callsign, server list, invite codes, the helper device token, and any admin key the user chose to keep. It can also open the helper socket (the helper allowlists the origin, not the path), and in PR #51 it can sign as the device. The radio's `script-src 'self'` also allows scripts from that other repo.
*Fix:* give the radio its own origin. A custom domain on Pages (a `CNAME` file) is enough. It also lets the helper and the API drop `https://tubss2.github.io`.

**B4. A compromised desktop renderer could use the bind recorder as a global keylogger.**
`hotkeys:record` makes the main process return the next key or side button pressed anywhere on the desktop, with no timeout and no focus check, and the renderer can call it again straight away. The renderer is sandboxed with `script-src 'self'`, so this needs another bug first. It does turn an XSS into the exact thing the app promises never to do.
*Fix:* arm recording only while the main window is focused and the keybind screen is open. Cancel it after about 10 seconds or on blur. Allow one recording at a time.

**B5. Electron fuses are not set.**
`RunAsNode`, `EnableNodeOptionsEnvironmentVariable`, `EnableNodeCliInspectArguments`, `EnableEmbeddedAsarIntegrityValidation`, and `OnlyLoadAppFromAsar` are at their defaults. Then `RadioNet.exe` can be run as a plain Node interpreter, a handy tool for other malware. ASAR integrity is also worth more once the build is signed.
*Fix:* `@electron/fuses` in an electron-builder `afterPack` hook.

### Low

| ID | Finding | Fix |
|---|---|---|
| C1 | `isAllowedAppUrl` accepts any `file:` URL that contains `index.html` or `overlay.html`, anywhere on disk. `fromApp()` uses the same test to trust IPC senders. | Compare against the exact paths of the packaged renderer files. |
| C2 | `FileChannelStore` skips the MAC check when the `mac` field is missing. The MAC key sits in `secrets.env`, which the same `radionet` user can read. The MAC adds little. | Require `mac` when a key is set, or drop the MAC and say file permissions are the control. |
| C3 | `setup.sh` downloads Node, LiveKit, and Caddy with `curl \| tar` and no checksum. | Pin SHA-256 values next to the version variables. |
| C4 | LiveKit, the API, and Caddy all run as `radionet`, and `secrets.env` is readable by that user. A Caddy bug becomes the LiveKit secret, which can forge every token. | Separate users, with the secret file readable only by the API and LiveKit. |
| C5 | The Pages deploy job also runs from `cursor/local-callsign-keybinds-3d59`. A push to that old branch replaces the production site. | Deploy from `main` only. |
| C6 | The helper accepts `http://localhost:*` and `http://127.0.0.1:*` origins in release builds. Any local web page can try to pair. It still needs the 12-character code. | Allow loopback origins only in debug builds. |
| C7 | The helper build uses `cargo build` without `--locked`, on a floating `stable` toolchain. CodeQL scans JavaScript only, not Rust or the workflow files. | Add `--locked`. Add the `actions` language to CodeQL. |
| C8 | A phone token keeps working for its two hours after the invite rotates (`/api/phone/redeem` does not check the epoch). | Carry the epoch into the phone pairing row and check it. |
| C9 | Caddy does not send HSTS for the API host. The apps use `https://`, so this matters only for a person who types the bare host. | `header Strict-Transport-Security "max-age=31536000"`. |
| C10 | The unsealed fallback in the helper's `load_device` accepts a plaintext file. Only a process running as the same user can plant one. | Fail closed on Windows, as `seal` already does. |
| C11 | `helper-5` has no `SHA256SUMS.txt`. The desktop release has one. | Attach a checksum, or better, an attestation (see the downloader section). |

### Things that held up

- **Sessions and secrets.** Session HMAC, admin key hashing, constant-time compares, the setup code, invite entropy, bounded rate-limit maps, the 64 KB body limit, and the CORS allowlist are all sound.
- **LiveKit grants.** Microphone only, no data, no metadata. The phone gets a data-only room.
- **Phone pairing.** 32-byte one-time codes in the fragment, hashed at rest. The page waits for a tap. `allowedPhoneApi` blocks a rewritten API host.
- **Helper.** Binds to `127.0.0.1` only. Checks `Origin` and `Host`. Answers Private Network Access only for the allowlist. Burns the code after one use. The device token is stored as a DPAPI-sealed hash. Raw Input drops unbound keys before anything leaves the process. The socket carries actions, not key codes.
- **Electron windows.** Sandbox on, Node off, navigation and new windows denied, camera denied, IPC payloads validated. The admin key and session token are not written when DPAPI is missing.
- **Updater.** Pinned to `Tubss2/radio-net`. Asks before downloading. No downgrade.
- **VPS.** Key-only SSH, fail2ban, unattended upgrades, Caddy logs drop request headers, and only Caddy and the LiveKit media ports are public.

## Docs that are now wrong

These matter because testers and the other agents read them.

- **`SECURITY-REVIEW.md` rates v0.4.3.** Several of its "Open" rows are fixed in v0.4.5: the sandbox (C1 in that table), download-on-click, checksums, and the constant-time setup code. Several "not deployed" notes are also false, because the live API has the CORS allowlist and the hardening.
- **`SECURITY.md`** still says the setup code is compared with ordinary equality and that the sandbox is off. It also says the CSP allows any `https:` host. That is true for the desktop app, but the web app pins its hosts.
- **The `SECURITY-REVIEW.md` row for #13** says the release job is the only one with `contents: write`. See A1.
- **`SECURITY-WEB.md`** says the API CORS allowlist is "Not deployed". It is deployed.

Fix: mark `SECURITY-REVIEW.md` as the v0.4.3 snapshot, and keep this file as the current state.

## Planned work, and what it will run into

### Device identity (PR #51)

The design is sound: P-256 keys, a non-extractable key in IndexedDB, single-use challenges bound to community and device, and role read from the server row, not from the token. Points to settle before code:

1. **Legacy `POST /api/join` keeps the old door open.** A revoked person can type the invite again and get a 12-hour session with no device row. Revocation means nothing until legacy join is off, or until a revoke also rotates the invite. Set a removal date (Q8).
2. **Revoke has to remove people from LiveKit, and that cannot be best-effort.** Today nobody is removed (B1). If the remove call fails, retry it, or delete the rooms.
3. **Safari storage eviction.** Safari deletes script-written storage, IndexedDB included, for a site the user has not interacted with in 7 days, unless the site is added to the home screen. iPhone users, and anyone who opens the radio once a week, will lose their key and need an invite again. Plan the "new device, old row" admin flow, or the export file, for that case.
4. **Shared origin.** Q10 asks to accept that other `tubss2.github.io` pages can sign as the device. Given B3, answer that by moving the origin instead.
5. **More data on the server.** `lastSeenAt`, callsign per device, and invite use counts are new personal data. Update [`PRIVACY.md`](PRIVACY.md), and decide how long rows for revoked devices stay.
6. **The JSON store.** Device rows and an atomic increment of invite uses are fine on one Node process. A second process, or a move to SQLite, has to keep that check-then-increment step atomic.

### Moving to a domain (and off the shared origin)

This fixes A3, B3, and clickjacking (W4), if the API and app are served from Caddy, or from Pages under a custom domain. The trap is the hard-coded names:

| What hard-codes the current names | Where |
|---|---|
| API and LiveKit URLs baked into the installer | `VITE_API_URL`, `VITE_LIVEKIT_URL` in `windows-installer.yml` |
| Web app CSP | `spike/client/src/shared/pagesCsp.ts` |
| Phone API allowlist | `allowedPhoneApi` in `phonePage.ts` |
| Helper origin allowlist | `PAGES_ORIGIN` in `helper/src/protocol.rs` (needs a new `helper-N`) |
| API CORS allowlist | `PAGES_ORIGIN` in `spike/server/src/cors.ts` |
| Pages root for the desktop's phone link | `PAGES_ROOT` in `phonePage.ts` |

Safe order:

1. Serve the new names alongside the old ones on the VPS.
2. Ship a desktop update and a new helper that accept both.
3. Point the web app at the new names.
4. Keep the sslip names running until old installs have updated.
5. Then retire them.

Installed desktop apps keep talking to the old names until they update, so do not tear those down first.

### Code signing

Until there is a certificate, add **GitHub artifact attestations** (`actions/attest-build-provenance`) to both release workflows. It is free. It lets anyone run `gh attestation verify RadioNet-Setup-0.4.5.exe -R Tubss2/radio-net` and see which workflow and commit built the file. It does not satisfy SmartScreen, and the updater does not check it, but it answers "did this come from the public source?" for a cautious friend.

When signing arrives, also: remove `verifyUpdateCodeSignature: false` and the runtime skip in `updater.ts`, set `publisherName`, turn on the ASAR integrity fuse (B5), and sign the helper too. Azure Artifact Signing is the cheapest path. Its eligibility rules for individuals have changed over time, so check them before buying an OV certificate.

### Raw Input in the desktop app, and the anti-cheat test

- The helper proves the Raw Input approach. Porting it into Electron removes the low-level hook (K1 in the old review), which is the most "spyware-shaped" thing in the project.
- Raw Input still delivers every key to the process. The filtering has to stay in native code.
- The draft email to Bulkhead was never sent. A kernel anti-cheat ban is often a hardware ban, so send that email before the app goes beyond a few willing testers. Until there is an answer, keep the "throwaway account" advice in `TESTING.md`.

### Smaller plans

- **Restricted channels.** The server already decides grants per channel (`canListen` and `canTransmit`). When tags arrive, keep "only one transmit channel" a client rule, but make sure a listen-only channel is listen-only in the token, not in the UI.
- **Phone listen-only (backlog).** Today a leaked phone code can press the talk button for two hours. A listening phone would turn the same leak into a two-hour eavesdrop. If it ships, give the phone its own subscribe-only voice grant, show the phone in the listener count, and keep the two-minute single-use code.
- **Discord login (backlog).** OAuth adds a client secret on the server and stored tokens. Keep it out of the browser and out of `store.json` in the clear.
- **Other groups on the Sydney server.** The setup code is one secret for the whole server, and the operator can hear every community. Say so on the create screen. Self-hosted communities will not work with the desktop app today, because the baked LiveKit URL overrides the URL the API returns (`resolveLivekitUrl`). That is a functional gap, and it also means users cannot actually choose a server they trust more.
- **Growth.** The rate limits are in memory, keyed by IP. Phone pairing codes are in memory too. There is one API process, one JSON file, and `max_participants: 50` per room. That is fine for a squad, but a busy public server needs a real store and limits at the proxy.
- **Many AI agents writing the code.** Several agents push branches, and one published a release. Reviews are PR comments. The controls in A1 and A2 (rulesets, a protected release environment, required PRs) are what keep a confused agent, or a prompt-injected one reading an issue or a dependency README, from shipping a build.

## If I were downloading these apps

### Web app (nothing to install)

**What a person worries about:** "Is this a real site? What does it keep? Can it listen when I'm not talking?"

**Honest answer:**
- It is a static site on GitHub Pages with no third-party scripts. It asks for the microphone when you join.
- The mic stays open but muted while you are tuned to a channel you can talk on. Push-to-talk releases when the tab loses focus.
- Your callsign, server list, and invite codes stay in this browser.
- The person who runs the server (Tobias) can hear the radio and see your IP address. There is no end-to-end encryption.

**Residual concern:** another site on `tubss2.github.io` can read what this one stores (B3).

**Risk:** low. This is the option I would tell a cautious friend to use.

### Helper (`RadioNetHelper.exe`)

**What a person worries about:** "An unsigned exe that watches my keyboard?"

**Honest answer:**
- It uses Windows Raw Input, not a hook. It receives every key and keeps only Talk, previous channel, and next channel.
- It talks only to `127.0.0.1`, and only to the radio page after you type its code. It sends actions, not key names.
- It has no tray icon, no auto-start, and no updater, so the copy you run does not change by itself.
- It cannot touch the microphone.

**What is missing:**
- No signature, so SmartScreen will warn.
- No checksum or attestation on the release, so you cannot verify it was built from the public source.
- The current release was published by a bot outside the approval workflow (A2).
- Antivirus may flag a new, unsigned keyboard watcher.
- Raw Input is a low anti-cheat risk, but not zero.

**Risk:** low to moderate. It comes down to trusting one GitHub release.

### Desktop app (`RadioNet-Setup-0.4.5.exe`)

**What a person worries about:**
- a keylogger
- updates replacing the app with something else
- an anti-cheat ban
- an always-on-top window over the game
- the microphone

**Honest answer:**
- The keyboard and mouse hook is a low-level Windows hook, which is the same API a keylogger uses. It runs only after a first-run screen, can be turned off, and drops unbound keys. That filter is in JavaScript, after the key has already reached the process.
- Updates are unsigned. The app asks before downloading and before installing, but it will install whatever GitHub marks as the latest Radio Net release. Today more parties than Tobias can create that release (A1, A2).
- Anti-cheat: Bulkhead has not been asked. The overlay and hook are the patterns kernel anti-cheat looks for.
- The app's own chooser already says "only if you know and trust Tobias", and that is accurate.

**Risk:** moderate to high on a PC you care about until A1 and A2 are closed. After that, signing and Raw Input are what would move it to "fine".

## Do these first

1. **Lock down releases.**
   - Split the installer workflow into a read-only build job and a gated publish job.
   - Add `persist-credentials: false`.
   - Add a `release` environment with Tobias as reviewer.
   - Add tag rulesets for `v*` and `helper-*`.
   - Require PRs on `main`.
   - No agent creates tags. (A1, A2)
2. **Make invite rotation drop everyone from LiveKit rooms**, and move `assertProductionConfig` above the dev seed. (B1, B2)
3. **Add artifact attestations and a helper checksum** to the release workflows. (C11, code signing)
4. **Buy the domain.** Give the web app its own origin, add CAA records, and follow the migration order above. (A3, B3, W4)
5. **Harden the desktop app.** Gate the bind recorder, set Electron fuses, and tighten `isAllowedAppUrl`. (B4, B5, C1)
6. **Before identity ships**, decide the legacy-join removal date and make revoke remove LiveKit participants. (PR #51)
7. **Send the Bulkhead email** before the desktop app or helper goes beyond willing testers.
8. **Mark `SECURITY-REVIEW.md` as the v0.4.3 snapshot** and link this file from the README.
