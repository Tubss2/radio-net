# Device identity (design)

Status: proposal. This pull request adds the design only. It does not change the API, the web app, or the desktop app.

Radio Net stays without accounts. There is no email, password, Discord login, or username to register. A person is a **device key** generated on that browser or that install, enrolled into a community once with an invite code. Later visits prove the same key with a signature. An admin can remove one device and leave the invite in place.

This reopens one line in [`PLAN.md`](PLAN.md) §4. That section treated “the server remembers a device, so it can kick it” as an account, and picked a stateless invite instead. Squad use needs the kick. The shape here is the TeamSpeak identity file: the id is born on the device, the server stores the public key so it can recognise and revoke that id, and nothing else has to be remembered.

[`SECURITY.md`](SECURITY.md) and [`SECURITY-WEB.md`](SECURITY-WEB.md) stay the threat model. This note is the change those reviews should read before any implementation PR.

## What ships today

Joining is `POST /api/join` with an invite code and a callsign. The API returns an HMAC session (`signSession` in `spike/server/src/accounts.ts`). `SESSION_TTL_SECONDS` is 12 hours. The server does not store the token. Each join mints a new `sid`, and that `sid` is the LiveKit identity, so the same person is a new participant every visit.

The session carries `epoch`. Rotating the invite bumps `community.sessionEpoch`, and `member()` rejects any token whose epoch does not match. One rotation logs everybody out, including people who should have stayed.

A community has one `inviteCode` string in `store.json`, kept in plaintext so the UI can show it. `publicCommunity` returns that code to every member. The admin key is `rnk_` plus 32 random bytes, shown once; the server stores SHA-256. `POST /api/communities/:cid/admin/rotate` with the server setup code replaces the hash. Join attempts are limited to 10 per minute per IP (`joinRateLimit`), and every route except `/health` shares 120 per minute per IP.

The web app keeps the bearer token in `sessionStorage` (`rn.sessions`). Closing the tab drops it. The invite and the callsign sit in `localStorage`. The admin key is written to `localStorage` only when `rememberAdmin` is set. The desktop app stores the same profile with `safeStorage` when the OS allows it.

The phone button is a separate short-lived pairing code. It is not a member and it does not get a key in this design.

## Decisions in this proposal

| Topic | Proposal |
|---|---|
| Algorithm | ECDSA P-256 with SHA-256, via WebCrypto. See question 1. |
| Device id | Lower-case hex SHA-256 of the SPKI bytes. The client sends the id; the server recomputes it and rejects a mismatch. |
| Day-to-day private key | Non-extractable. Web: IndexedDB on the Pages origin. Desktop: a contract for the desktop agent, `safeStorage` in the main process, signing over IPC. The renderer never sees the private key. |
| Backup | A wrapped PKCS#8 file, created while the key still exists in extractable form, then discarded. See Export. |
| First visit | Invite code enrolls this device. A repeat enroll of the same active key does not consume a use. |
| Later visits | Signed challenge. The user does not type the code again. A 12-hour timer is not what brings the code back. |
| Access token | HMAC bearer, same family as today, plus `did` (device id). Suggested lifetime 1 hour, refreshed with a new signature. See question 7. |
| Revocation | The server looks up the device on each member request. A revoked device fails even while the HMAC is unexpired. |
| Invite rotation | Revokes that invite row and mints a replacement. Registered devices stay joined. Legacy tokens still follow `sessionEpoch`. |
| Admin | The `rnk_` key remains break-glass. A device can be marked `admin` and then call admin routes with its session. The setup code remains the way back if every admin device and the admin key are gone. |
| Phone | Stays a button for a visit that already joined. It does not enroll. |

One device key may enroll in many communities. Each community has its own device row (role, callsign, revoke flag). The private key is not per community.

## Key generation

### Web

On first need (join, or opening a server that has no key yet):

1. `crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])`. Extractable is true only for this step, so a backup can be wrapped.
2. `exportKey('spki')` and `exportKey('pkcs8')`.
3. Device id = SHA-256 of the SPKI bytes, hex.
4. If the user is exporting now, wrap the PKCS#8 (see Export) and offer the file.
5. `importKey` the PKCS#8 with `extractable: false` and usage `['sign']`.
6. Store `{ privateKey, publicKey, deviceId, createdAt }` in IndexedDB database `radionet-identity`, object store `keys`, key `self`. CryptoKey values survive a structured clone into IndexedDB.
7. Drop the extractable key and the PKCS#8 bytes.

After that, `exportKey` on the stored private key fails. Ordinary rejoin never asks for a passphrase.

IndexedDB is per origin. The site is `https://tubss2.github.io/radio-net/`, so the origin is `https://tubss2.github.io`. Any other GitHub Pages site on that same user shares this database. [`SECURITY-WEB.md`](SECURITY-WEB.md) already treats script on that origin as able to read `localStorage`. A device key is a new asset in the same place: script on that origin can call `subtle.sign` while the page is open. It cannot copy the key out and use it from another machine. CSP stays `script-src 'self'` with no third-party script.

The access token stays in `sessionStorage`. A new tab signs a challenge; it does not need a long-lived bearer in `localStorage`.

### Desktop (contract only)

The desktop agent owns Electron main. This design does not change it. When that work starts, the contract is:

- Generate the key in the main process.
- Encrypt the PKCS#8 with `safeStorage.encryptString` and write it under userData (a sibling of the profile file, mode restricted to the user).
- IPC: `identity:device` returns `{ deviceId, publicKeySpki }`. `identity:sign` takes the canonical challenge bytes and returns the signature. `identity:export` and `identity:import` take a passphrase and move the wrapped file.
- The renderer sends signatures to the API. It does not receive the private key.

If `safeStorage` is unavailable, the desktop build refuses to write a plaintext private key and tells the person. Question 12 asks whether a loud fallback is ever acceptable. Today’s profile file does fall back to plaintext; a device key should be stricter because it is a long-lived credential.

## Enroll with an invite, once

`POST /api/join/register`

```json
{
  "inviteCode": "K7QM-2XPA",
  "callsign": "Actual",
  "deviceId": "<64 hex chars>",
  "publicKeySpki": "<base64 of SPKI>",
  "powNonce": "<optional>"
}
```

The server:

1. Applies the join rate limit, then checks proof-of-work when the server has a difficulty set.
2. Normalises the code the same way as `normaliseInvite` and finds the invite row.
3. Rejects a missing, revoked, expired, or exhausted invite.
4. Decodes the SPKI, hashes it, and requires equality with `deviceId`. Cap the SPKI at 256 bytes and the signature path at the sizes below.
5. If this community already has this device id and it is not revoked, it does not increment `uses`. It updates the callsign and last-seen time and returns an access token.
6. If the row exists and is revoked, enrollment fails until an admin restores it or the person uses a new key. A leaked invite must not quietly un-revoke.
7. Otherwise it inserts the device, increments `uses` by one, and returns an access token.

Two registers of a limited invite have to serialise on the single Node process so both cannot pass `uses < maxUses`. The in-memory store and the file store both do that increment inside the request before the next one runs; the implementation note is to keep the check and the increment in one synchronous section before any `await` that yields.

The same device id across a browser restart is the same row. Re-entering the code after a cleared `sessionStorage` is the enroll path only when the server has no active row. The client tries a challenge first when it has a key, and shows the code field when the server says this device is not enrolled.

## Later joins

### Challenge

`POST /api/communities/:cid/challenge`

```json
{ "deviceId": "<64 hex chars>" }
```

Response:

```json
{
  "challengeId": "<uuid>",
  "nonce": "<base64url, 32 bytes>",
  "expiresAt": "<ISO, 60 seconds from now>"
}
```

Challenges live in memory on the API process: `{ challengeId, nonce, communityId, deviceId, expiresAt, used }`. They are not written to `store.json`. A restart drops them; the client asks for another. Cap the table (on the order of 10k) and evict the oldest expired rows.

The server creates a challenge only for a device row that exists and is not revoked. An unknown id gets the same response shape as a bad id after the rate limit: HTTP 404 with a stable message, `This device is not enrolled`. That lets the client show the invite field. Random guessing of device ids is the same 10-per-minute budget as joins. Question 9 in the security list below is whether that 404 is an acceptable oracle.

### Signature

`POST /api/communities/:cid/join`

```json
{
  "challengeId": "<uuid>",
  "deviceId": "<64 hex chars>",
  "callsign": "Actual",
  "signature": "<base64>"
}
```

The signed bytes are the UTF-8 of this string, with `\n` between fields and no trailing newline:

```text
rn-join.v1
<challengeId>
<nonce>
<communityId>
<deviceId>
```

WebCrypto `sign` / `verify` with `{ name: 'ECDSA', hash: 'SHA-256' }` uses IEEE P1363 (`r || s`, 64 bytes) for P-256. The server accepts that encoding only, length exactly 64 bytes. The challenge is single-use, must be unexpired, and must name this `communityId` and this `deviceId`. Verification uses the stored SPKI.

On success the server updates `callsign` and `lastSeenAt` and returns an access token. The invite code is not part of this request.

## Access tokens

Keep HMAC tokens so channel lists and LiveKit grants stay cheap. Add fields:

| Field | Meaning |
|---|---|
| `did` | Device id. Present on device sessions. |
| `sid` | Per-token id, still a random UUID. Phone pairing can keep using it until it moves to `did` (question 13). |
| `scope` | `member`, as today. |
| `epoch` | Copied for legacy tokens. Device tokens omit it. |

`member()` for a token that has `did`:

- Signature and expiry still have to pass.
- Load the device. Missing or `revokedAt` set means 401, `This device was removed. Ask an admin for an invite.`
- Do not compare `sessionEpoch`. Rotating an invite does not log this device out.
- LiveKit identity for voice grants is `d` + the device id (65 characters). The display name stays the callsign. The same browser keeps the same participant id across visits.

`member()` for a token with no `did` (today’s `POST /api/join`): unchanged. Epoch mismatch still returns `This invite was rotated. Join again.` Legacy joins do not increment invite `uses`, or a cap of five would burn out on refreshes from old clients.

Suggested access lifetime is 1 hour. The open tab refreshes a few minutes early by signing a new challenge. The user does not see that. Question 7 is the number.

Role is not taken from the token. Admin checks load the device row (or the admin key). A demotion applies on the next request.

## Members, devices, invites

### What an admin sees

`GET /api/communities/:cid/devices` requires an admin (admin key or an admin device). Each row:

- `deviceId` (full) and a short label, the last 8 hex chars
- last callsign
- `role`
- `createdAt`, `lastSeenAt`, `revokedAt`
- invite id and invite label used at enrollment
- nothing that is a private key, a session token, or an IP

Callsigns stay non-unique. Two radios can both say `Actual`. The short device id is how the admin tells them apart.

### Revoke one device

`POST /api/communities/:cid/devices/:deviceId/revoke` sets `revokedAt`. It does not change any invite, `sessionEpoch`, or other devices.

The API then asks LiveKit to `RemoveParticipant` for identity `d` + device id on each channel room of that community. That call is best-effort: a LiveKit outage still leaves the device revoked, and the next token request fails. Grants already issued last until their existing TTL (10 minutes today) if the remove call does not land.

`POST .../restore` clears `revokedAt` without consuming an invite. It is for a mis-click. It is the wrong tool for a stolen key: the thief holds the same key, so restore lets them back in. A stolen device is handled by leaving it revoked and enrolling a new key. Question 11 asks whether restore ships in the first implementation.

### Invite codes

A community can hold more than one invite.

```ts
interface Invite {
  id: string;
  communityId: string;
  code: string; // XXXX-XXXX, unique on this server
  label: string | null;
  createdAt: string;
  createdBy: string; // device id, or "admin-key"
  maxUses: number | null; // null means no cap
  uses: number;
  expiresAt: string | null;
  revokedAt: string | null;
}
```

Creating a community still returns one invite, stored as a row with `maxUses: null`, `expiresAt: null`, and mirrored on `community.inviteCode` so current clients keep working.

Admin routes:

| Method | Path | Body | Result |
|---|---|---|---|
| GET | `/api/communities/:cid/invites` | | List, including the code, uses, cap, expiry, revoked |
| POST | `/api/communities/:cid/invites` | `{ label?, maxUses?, expiresAt? }` | A new code, shown once in the response and stored so the admin list can show it again |
| POST | `/api/communities/:cid/invites/:inviteId/revoke` | | `revokedAt` set. Existing devices stay. |

`maxUses` is a positive integer or omitted. `expiresAt` is an ISO time in the future or omitted. `uses` counts new device rows only.

`POST /api/communities/:cid/invite/rotate` keeps its path. New behaviour: revoke the invite whose code equals `community.inviteCode`, insert a fresh unlimited invite, set `community.inviteCode` to it, and bump `sessionEpoch` so legacy tokens die. Device tokens stay valid.

Member responses stop adding new invite codes. During migration, `inviteCode` on the community object remains, because current pages copy it from there. A later client can hide it. Question 4 asks whether members should see codes at all once the admin list exists.

## Anti-spam

What already exists stays: 10 join attempts per minute per IP, 120 requests per minute per IP, invite alphabet of 31 symbols and 8 characters.

Add:

| Control | Where |
|---|---|
| The join limiter | `POST /api/join`, `POST /api/join/register`, `POST /api/communities/:cid/challenge`, `POST /api/communities/:cid/join` |
| Per-device challenge cap | 30 challenge issues per minute per device id, in memory |
| Request size | SPKI ≤ 256 bytes. Signature exactly 64 bytes. Callsign still 1–32 after `cleanLabel`. |
| Proof of work | Off unless `RN_POW_BITS` is set. Register (a new device only) must present `powNonce` such that SHA-256 of `rn-pow.v1\n` + invite code + device id + nonce has that many leading zero bits. The server sends the difficulty on a 400 the first time, or the client reads `GET /api/join/policy`. Checking the hash is cheap; the search is the client’s cost. |

Proof of work does not replace the invite. It is for the case where a code has already leaked into a large chat and a botnet spends the use cap. A cap of 30 enrollments is the actual door. Sixteen bits is a reasonable first difficulty (about 65k hashes, fine in a tab). Question 5 asks whether this is in the first implementation or a flag left at zero.

Failed signatures count toward the IP limit. Verification runs after the limit check. The server does not log codes, signatures, tokens, admin keys, or private keys.

## Export, import, and a lost device

A non-extractable key cannot be exported later. The backup is made in the extractable window, or the user has no file.

Wrapped file `radionet-identity.json`:

```json
{
  "v": 1,
  "kdf": "PBKDF2-SHA-256",
  "iterations": 600000,
  "salt": "<base64>",
  "iv": "<base64, 12 bytes>",
  "ciphertext": "<base64, AES-256-GCM of the PKCS#8, tag appended>",
  "deviceId": "<hex>",
  "publicKeySpki": "<base64>"
}
```

The passphrase is required to write this file. It is not required to join on the machine that already holds the non-extractable key. PBKDF2 is the proposal because WebCrypto has it without a bundled Argon2. Question 2 asks whether the first run should force a passphrase even when the user is not exporting yet. If they skip it, a later export is impossible unless the wrapped blob was also kept in IndexedDB at generation time. Preferred approach: always wrap with a passphrase at generation and keep the ciphertext in IndexedDB, so Export only downloads a file that already exists. That does force a passphrase once, on first run.

Import:

1. Unwrap with the passphrase.
2. Check SHA-256(SPKI) equals `deviceId` inside the file.
3. Import as non-extractable into IndexedDB, replacing any previous key on this origin.
4. The next join is a challenge as that device id.

Copying the file copies the same device id, which is what a backup and a move to a new PC want. Revoke hits every copy. The export screen says that in one sentence.

A second laptop that should be kickable on its own needs its own key. The person enrolls it with an invite (one use). The admin list shows two rows. Question 3 asks whether the first version also needs a “link this device” voucher so the second key can enroll without spending a shared invite, grouped under one label.

Lost-device cases:

| Situation | What the person does |
|---|---|
| Still has the file and the passphrase, and the old device is trusted | Import. Same id. |
| Old device stolen, file still exists | Do not import. Generate a new key, enroll with an invite, ask an admin to revoke the old id. |
| No file, no old device | Same as a new member: invite, new key. Tell an admin which old row to revoke (callsign plus short id, and the time they last talked). |
| Admin device gone, admin key still on paper or in a password manager | Register the new device, then claim admin with the key (below). |
| Admin device gone and the admin key gone | Server setup code, existing `POST /api/communities/:cid/admin/rotate`, then claim admin from the new device. |

There is no email reset. The server cannot rebuild a private key it never had.

## Admin key on top of a device

The admin key stays a bearer secret. Promoting a device does not hide that key inside the device key, and it does not upload the key to the server.

`POST /api/communities/:cid/claim-admin` with the device’s access token and header `x-admin-key`. The server checks the key against `adminKeyHash` and sets that device’s `role` to `admin`.

`POST /api/communities/:cid/devices/:deviceId/role` with body `{ "role": "admin" | "member" }` is the same change done by someone who is already an admin, aimed at another row.

Admin routes (channels, invite mint and revoke, device revoke and restore, role, delete community) accept either:

- `x-admin-key` matching the hash, as today, or
- a device access token whose row is `role: admin` and not revoked.

The setup-code rotate endpoint is unchanged and does not require a device. After a rotate, previously claimed devices are still `admin` until someone demotes them. Question 17 asks whether rotating the break-glass key should also clear device admin roles. This proposal leaves them: the key rotate is for a lost key, and the devices are the people who still run the net. A stolen admin key is handled by rotating the key (the thief’s copy dies) and demoting any device the thief enrolled.

The creating client can claim admin immediately after the first register, then offer Forget on the admin key. The key still works until it is rotated, so a second admin can be given the key or an admin role. Question 17 also asks whether the first run should keep showing the key as the thing you copy, which is what the app does now.

## Phone and the helper

The phone redeems a one-time code for a `ptt`-scoped token. That stays. The phone does not generate a community device key and does not appear on the member list.

When device tokens refresh every hour, a phone bound only to `sid` would die on refresh. The implementation that introduces `did` should bind the phone row to the device id (and still to a single community). Closing the dialog, Disconnect, and the parent leaving still end the visit, as they do now. Question 13 confirms the phone stays out of identity.

The helper is a localhost key watcher. It does not enroll.

## Server data model

`store.json` gains two arrays. Old files load with those arrays missing.

```ts
interface Device {
  id: string; // sha256(spki) hex
  communityId: string;
  publicKeySpki: string; // base64
  role: 'member' | 'admin';
  callsign: string;
  inviteId: string;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
}

// Invite as in the section above
```

`Community` keeps `inviteCode`, `adminKeyHash`, and `sessionEpoch`. `sessionEpoch` applies to legacy tokens.

On load, for each community, if no invite row has `code === community.inviteCode`, insert one: new id, `maxUses: null`, `uses: 0`, `expiresAt: null`, `revokedAt: null`, `createdBy: "admin-key"`, `createdAt` copied from the community. That is the whole migration of existing Sydney data. Nothing is deleted. `validateSnapshot` treats missing `devices` and `invites` as empty before that synthesis.

Challenges are process memory. A second API process would not see them. Sydney runs one API process; the design assumes that. A later SQLite move can store challenges if the process count changes. Device and invite rows are the durable part, in the same JSON snapshot the file store already writes atomically.

`GET /health` can grow a `identity: 1` flag when the routes exist, so a client knows whether to offer register. Until that flag is true, clients keep using `POST /api/join`.

## API, collected

New:

| Method | Path | Who | What |
|---|---|---|---|
| GET | `/api/join/policy` | public, rate-limited | `{ powBits: number }` |
| POST | `/api/join/register` | invite | Enroll this device or refresh an active one. Returns the same session payload as join, with `did` set. |
| POST | `/api/communities/:cid/challenge` | enrolled device id | One-time nonce. |
| POST | `/api/communities/:cid/join` | signature | Access token. |
| GET | `/api/communities/:cid/devices` | admin | Member and device list. |
| POST | `/api/communities/:cid/devices/:deviceId/revoke` | admin | Revoke one device. |
| POST | `/api/communities/:cid/devices/:deviceId/restore` | admin | Clear revoke. See question 11. |
| POST | `/api/communities/:cid/devices/:deviceId/role` | admin | `admin` or `member`. |
| POST | `/api/communities/:cid/claim-admin` | device session + admin key | This device becomes admin. |
| GET | `/api/communities/:cid/invites` | admin | Invite list. |
| POST | `/api/communities/:cid/invites` | admin | Mint a code. |
| POST | `/api/communities/:cid/invites/:inviteId/revoke` | admin | Retire a code. |

Unchanged paths with new rules:

| Path | New rule |
|---|---|
| `POST /api/join` | Still 12 hours, still no device row, still does not consume `uses`. Stays until question 8 is decided. |
| `POST .../invite/rotate` | Replaces the primary invite row and bumps `sessionEpoch`. Device sessions stay. |
| `POST .../admin/rotate` | Still the setup code. Still replaces `adminKeyHash`. |
| Member channel and token routes | Device tokens skip the epoch check and fail when the device row is revoked. |
| Admin channel routes | Admin key or admin device. |

Client work is a later PR, after this design is agreed. The web app owns IndexedDB, the register-or-challenge join, and the admin lists. The desktop agent owns the `safeStorage` contract. Neither starts from this document.

## What a security review should weigh

- Script on `https://tubss2.github.io` can sign as the device for as long as the user has the site open, including other Pages projects on that user. It cannot export the non-extractable key. A stolen access token still lasts until its expiry or until revoke, whichever the server enforces first. Revoke is a lookup, so it beats the HMAC expiry.
- The wrapped export file plus the passphrase is the private key. It belongs in a password manager or an encrypted disk, not in the repo and not in `localStorage` in the clear.
- Challenge replay is closed by single-use, a 60-second life, and binding to community id and device id. The canonical string includes a version tag so a later field can be added without accepting old signatures.
- Device id is the hash of the public key, so a caller cannot attach their signature key to someone else’s id.
- Admin role inside a token would go stale. The server reads the row.
- Invite codes remain plaintext in `store.json`, as they are today, because the admin UI shows them.
- Proof of work is optional cost, not authentication.
- Logging stays free of tokens, keys, signatures, and invite codes.
- Legacy `POST /api/join` is still “possession of the code is membership” until it is removed. Shipping register without turning that off leaves the old door open on purpose during migration.

## Open questions

For Tobias and for the security review. Numbered so a review can say “Q3: B”.

1. **P-256 or Ed25519.** This proposal is ECDSA P-256 with SHA-256 because WebCrypto and `subtle.verify` already match on every browser the web app cares about. Ed25519 is a smaller public key and a single encoding, if every target browser’s WebCrypto implements it by the time this is built. Which one should the implementation lock?

2. **Passphrase on first run.** Always wrapping a backup at generation means the first launch asks for a passphrase even though daily join does not. The alternative is a skippable backup, and then a lost browser with no file is a new device. Is the passphrase required?

3. **Second device.** Copying `radionet-identity.json` clones one id (revoke hits every copy). Enrolling again with the invite creates a second id (revoke hits one). Is the clone the “multiple devices” feature for v1, or do you also want a link voucher so a second key joins without spending a use and shows up grouped with the first?

4. **Who can see invite codes.** Today every member session receives `inviteCode`. This proposal keeps that field during migration and adds an admin-only list. Should members stop seeing codes once the admin screen exists?

5. **Proof of work.** Off unless `RN_POW_BITS` is set. Do you want it in the first server PR, or is the use cap enough until someone actually abuses a leaked code?

6. **Default cap.** The invite created with the community is unlimited, matching today. New invites can set `maxUses` and `expiresAt`. Should the original code stay unlimited?

7. **Access token lifetime.** Proposed 1 hour, refreshed by a signature, so the user never retypes a code because of the clock. 15 minutes shrinks a stolen bearer. 12 hours matches today and still allows revoke via the device lookup. Which lifetime?

8. **Legacy `POST /api/join`.** It has to stay for the clients already deployed, and it must not consume invite uses. How long does it remain after the web app enrolls devices? Options: until you say to remove it, or one release after the web client no longer calls it.

9. **Unknown device on challenge.** The proposal returns 404 `This device is not enrolled` so the UI can ask for a code. That tells a caller whether a device id is on the server. Is that acceptable under the rate limit?

10. **Pages origin.** Confirm the residual is accepted: non-extractable IndexedDB on `https://tubss2.github.io`, usable by any script that runs on that origin, not exportable. Moving the app to its own host is the way to leave the shared origin, and it is out of scope here.

11. **Restore.** Ship `restore` for a mistaken revoke, with the warning that a stolen key comes back too, or make revoke permanent and require a new enroll?

12. **Desktop without `safeStorage`.** Refuse to store the key, or allow a plaintext file with a warning the way the profile does today?

13. **Phone.** Confirm the phone never enrolls, and that its pairing should follow `did` so an access-token refresh does not drop the button.

14. **Who mints invites.** Any admin device, and also the break-glass admin key. Or only the admin key, with devices limited to revoke?

15. **Callsign history.** The device row stores the latest callsign only. Do you want previous callsigns kept for the admin list?

16. **One key, many communities.** The same device key can enroll in each community separately, with a separate revoke flag. Confirm that is what you want.

17. **Admin key after claim.** The creator’s device claims admin and the UI can forget the key. The key still works until setup-code rotate. Should rotate also clear every device `admin` role? And should the UI keep treating the key as the thing you copy to a second admin?
