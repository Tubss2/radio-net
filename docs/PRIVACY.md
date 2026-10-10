# Radio Net privacy notes

This describes the v0.4.3 client and the server the deploy kit installs. The in-app explanation should stay in step with this page.

## Short version

Radio Net stores your callsign on this PC. It has no account, no analytics, and no crash uploader. It watches the keys and mouse buttons you bind so push-to-talk works while the game is in front. It opens the microphone when you tune a channel you can talk on, and it sends audio while you hold the talk key. Voice and the join request go to the community server you choose. The person who runs that server can see your IP and your callsign, and can hear the radio.

## What the app reads on this PC

**Keys and mouse buttons.** A global hook runs while the app runs. The code acts on:

- the push-to-talk bind, the previous and next transmit binds, the channel-wheel bind, the overlay bind, and any per-channel binds you set
- the scroll wheel, while the channel wheel is open or the wheel key is held
- digit keys, while the wheel key is held
- Escape, including when the wheel is closed (v0.4.3 forwards every Escape press to the window; it is not logged)

Other keystrokes are dropped in the main process. They are not written to `radio-net.log` and they are not included in API requests. The hook still receives them first. That is the same family of API a keylogger uses. Quitting the app removes the hook. v0.4.3 has no separate pause button.

**Microphone.** The first time you tune a channel you are allowed to talk on, the app calls the system for a microphone track and publishes it to that voice room in a muted state. Holding push-to-talk unmutes it. Letting go mutes it. Windows can show the microphone as in use for the whole time you are tuned in. The app asks Electron only for media, and the page's permission handler allows that request. It does not ask for the camera, the screen, or your files.

**Speakers.** Remote voice is played locally. UI sounds play on this machine: static when you add a channel (on unless you turn it off), a tone when you change transmit channel, and a press/release cue only if you turn that one on.

**Nothing else.** No contacts, no game memory, no screenshots, no window titles.

## What stays on this PC

The profile file is `profile.bin` in the Electron user-data directory. It holds the callsign, server list, invite codes, keybinds, radio volumes, the admin key if this PC has one, and the current session token. When Windows DPAPI is available (normal for the packaged app), Electron `safeStorage` encrypts that file. If encryption is unavailable, v0.4.3 writes the same JSON in the clear, secrets included.

`radio-net.log` in the same folder is a rotating text log (three files, 256 KB each). Lines that contain a bearer token or an `rnk_` admin key are redacted. Keystrokes are not logged.

There is no telemetry switch because there is no telemetry.

## What leaves this PC

| What | Sent to | Trigger |
|---|---|---|
| Invite code and callsign | The API URL in the server box (the public installer uses `https://radio-149-28-170-200.sslip.io`) | Join, and rejoin |
| Admin key | That API, header `X-Admin-Key` | Channel create/delete, invite rotate, delete community |
| Which channel ids you want to hear | That API | Tune |
| Microphone audio | The LiveKit URL that API returns (the public installer uses `wss://lk-149-28-170-200.sslip.io`) | While push-to-talk is held. A muted track is published when you tune. |
| Your IP address | That server | Any connection |
| "Is there a new version?" | GitHub Releases for `github.com/Tubss2/radio-net` | Packaged app, at startup and every four hours |

The session token comes back from the API and is stored locally. Later requests send it as `Authorization: Bearer`. It expires after 12 hours. The server does not keep a copy.

Voice is not end-to-end encrypted. The LiveKit server forwards it and can decode it.

## Who runs the public server

The repository owner's Vultr VM in Sydney, as documented in [`../deploy/README.md`](../deploy/README.md). That operator can see invite codes, callsigns, channel names, source IPs, and the voice. Admin keys are stored as SHA-256 hashes. You can point the app at a different server. You are then trusting that server with the same things.

## Invite codes

An invite code is the door to a community. There is no per-person account behind it. Someone who has the code can join and choose any callsign. Rotating the code stops new joins with the old code. In v0.4.3 it does not end sessions that are already connected; those last until the 12-hour token expires.

## Updates

The packaged app downloads updates from the public GitHub Release and asks before it restarts. The installer is not code-signed, and the app disables signature verification so those unsigned files will install. See [`SECURITY-REVIEW.md`](SECURITY-REVIEW.md).

## What you can do

- Quit Radio Net when you are not using it. That is the v0.4.3 way to remove the keyboard hook and the microphone.
- Untune channels when you walk away, so the microphone device is released.
- Do not share the admin key. Do not share the invite code outside the group.
- Only join a server whose operator you are willing to let hear the radio.
