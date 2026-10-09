# UI direction

**Feel:** a consumer app, not a dev tool. Think Discord/Spotify polish: calm dark graphite, generous spacing, rounded cards, one clear state at a glance. See [`mockup.html`](mockup.html) (open in a browser) or `mockup.png`. The spike client already uses the same stylesheet.

**Principles**
1. **Where will I talk?** is always the biggest thing on the main window: a bar reading `TRANSMIT ON 59.5 Command`, which turns **red "ON AIR"** while you hold PTT. The in-game overlay is separate: it stays quiet until someone is actually transmitting.
2. **Two signal colours only:** green = live / your TX channel; red = you're on air. Everything else is greys plus one indigo for buttons.
3. **Frequencies read like a dial:** always monospace, one decimal (`50.0`, `50.5`, `45.0`), MHz label small and muted. Never three decimals. Steps are 0.5 MHz, from 30.0 to 87.5. The channel field accepts `50`, `50.0`, and `50.5`.
4. **Zero friction tuning:** a single box. Type `59.5` or `com` and press Enter. Double-click a channel to tune. No "connect" step.
5. **One card per tuned channel:** freq, name, who's talking (avatar ring glows), volume + mute, L/C/R ear, "Transmit here". Untune with ×.
6. **Real-radio function, no skeuomorphism:** no knobs, no static, no fake LCDs.
7. **Keys you can see:** current binds shown as keycaps in the TX bar. Rebinding = click, then press the key or mouse button.
8. **Admin stuff stays out of the way:** "+ New" and delete appear only for admins. The invite code sits under the community name.

**Layout (main window, ~1120×760, min 880×600)**
```
┌────┬──────────────────────┬───────────────────────────────────────────────┐
│ WD │ War Dogs NZ          │ ● ON AIR  62.0   Alpha FT   Talk[M4] Wheel[F2] │
│ 5R │ Toby · owner · K7QM… │───────────────────────────────────────────────│
│ +  │ [📻 Tune: 59.5 or …] │ ┌41.5 Arty──┐ ┌59.5 Command──┐ ┌62.0 Alpha──┐ │
│    │ CHANNELS      [+New] │ │5 tuned     │ │◉ Rhys talking│ │you're on air│ │
│    │ 41.5 Arty     tuned  │ │🔊───●──    │ │🔊─────●─     │ │🔊────●──    │ │
│    │ 45.0 Logi            │ │[L]C R  [TX]│ │L C[R] [TX G]│ │L[C]R ●TX    │ │
│    │ 59.5 Command   tuned │ └────────────┘ └──────────────┘ └─────────────┘ │
│    │ …                    │ ┌ + Tune more ┐                                 │
│    │ (T) Toby  mic✓ keys✓ │                                                 │
└────┴──────────────────────┴───────────────────────────────────────────────┘
```

**Overlay:** always on by default. A small unobtrusive box in a screen corner (top-left in the spike). Click-through, semi-transparent. When nobody is transmitting it is empty and invisible. While someone transmits, one line per talker: their display name, then the channel frequency and name (`Rhys  59.5 Command`). Several talkers stack. `F10` hides it. Position, size and opacity in settings.

**Channel wheel** ([`radial-wheel.png`](radial-wheel.png)): hold or press `F2`. A ring opens in the centre of the screen, one slice per tuned channel plus a **+** slice. CH1 is the lowest frequency, at 12 o’clock, then clockwise. Each slice shows the channel label (`CH1`), the frequency (`41.5 MHz`), and the name. A green dot means live and unmuted. The transmit slice is gold with a speaker icon. A muted slice is grey, with a mute icon and no green dot. Hover selects. Left-click sets the transmit channel. Right-click mutes or unmutes. Scroll steps that frequency by 0.5 MHz across the whole 30.0–87.5 grid. A frequency already tuned on another slice is skipped, so the dial is not boxed in by the other channels. Leaving a named channel shows “no net” until the dial lands on one. Shift+scroll changes that channel’s volume and shows a bar plus a percentage on the slice. The **+** slice (radio icon) opens a list in the hole: every community channel that is not already tuned, shown as frequency and name. Click one to tune it. An admin also gets a small **Enter frequency** control to create a new channel (frequency and name). Release, `Esc`, or `F2` again closes the wheel. Push-to-talk stays a separate key (`Mouse 4` in the spike). Tuning a channel, from that list or from the main window, plays a short squelch. Settings has a master volume for UI sounds and a switch to turn them off.

Opening the wheel focuses its window (`show` and `focus`, after a hide/show so Windows honours `setFocusable`) and accepts the mouse immediately, so the wheel works without a click. That takes keyboard focus from the game until the wheel closes. Clicks outside the ring still pass through. Windows delivers the mouse wheel only to the foreground window, and click-through does not forward it, so the global hook also applies scroll the whole time the wheel is open. If the game keeps focus (exclusive fullscreen), that hook is what moves the dial; it does not swallow the game's own scroll. Hold `F2` and press `1`–`9` still works without the wheel window focused. Scroll and number keys apply to the slice under the cursor, or to the transmit slice if nothing is hovered.

**Keybinds:** a settings screen on the radio. Click a slot, then press any key or mouse button, including Mouse 4 and Mouse 5. Left, right and middle click stay unbound so the click that arms the slot does not bind itself. Escape cancels. Slots are push-to-talk, open channel wheel (default `F2`), show or hide overlay (`F10`), cycle transmit (`Mouse 5`), plus a quick-select for each tuned channel (press sets the transmit channel). Two slots on the same input are shown as a conflict and still saved. Each slot can be cleared. Reset restores the defaults, including `F2` for the wheel. The set is stored with the local profile, and a profile that already saved a wheel key keeps that key. The same screen has **UI sounds**: a master volume and a switch. Off skips the squelch. The version is shown there (`Radio Net` plus the client semver). When a newer public GitHub Release has finished downloading, a bar offers **Restart now** or **Later**.

**First launch and servers:** the app asks for a callsign and stores it on this PC. Join is an invite code plus the server URL. Communities already joined are a list (name, URL, invite, last used) and rejoin in one click. Creating a community returns an admin key the app keeps and can copy. An admin can delete the community; the app asks for confirmation first, then drops it from the local server list. There is no account screen.

**Still to design (M3):** settings for devices, mic test meter, noise suppression, and blips; tray menu; empty/error states (server down, mic blocked, channel deleted). Member lists and role promotion are not part of this version: admin powers are the admin key.
