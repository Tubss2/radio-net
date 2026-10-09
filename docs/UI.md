# UI direction

**Feel:** a consumer app, not a dev tool. Think Discord/Spotify polish: calm dark graphite, generous spacing, rounded cards, one clear state at a glance. See [`mockup.html`](mockup.html) (open in a browser) or `mockup.png`. The spike client already uses the same stylesheet.

**Principles**
1. **Where will I talk?** is always the biggest thing on screen: a bar reading `TRANSMIT ON 59.500 Command`, which turns **red "ON AIR"** while you hold PTT. The overlay mirrors it in-game.
2. **Two signal colours only:** green = live / your TX channel; red = you're on air. Everything else is greys plus one indigo for buttons.
3. **Frequencies read like a dial:** always monospace, always 3 decimals (`41.250`), MHz label small and muted.
4. **Zero friction tuning:** a single box. Type `59.5` or `com` and press Enter. Double-click a channel to tune. No "connect" step.
5. **One card per tuned channel:** freq, name, who's talking (avatar ring glows), volume + mute, L/C/R ear, "Transmit here". Untune with ×.
6. **Real-radio function, no skeuomorphism:** no knobs, no static, no fake LCDs.
7. **Keys you can see:** current binds shown as keycaps in the TX bar. Rebinding = click, then press the key or mouse button.
8. **Admin stuff stays out of the way:** "+ New" and delete appear only for admins. The invite code sits under the community name.

**Layout (main window, ~1120×760, min 880×600)**
```
┌────┬──────────────────────┬───────────────────────────────────────────────┐
│ WD │ War Dogs NZ          │ ● ON AIR  62.100  Alpha FT     Talk[M4] Sw[G] │
│ 5R │ Toby · owner · K7QM… │───────────────────────────────────────────────│
│ +  │ [📻 Tune: 59.5 or …] │ ┌41.250 Arty─┐ ┌59.500 Command┐ ┌62.100 Alpha┐ │
│    │ CHANNELS      [+New] │ │5 tuned     │ │◉ Rhys talking│ │you're on air│ │
│    │ 41.250 Arty   tuned  │ │🔊───●──    │ │🔊─────●─     │ │🔊────●──    │ │
│    │ 45.000 Logi          │ │[L]C R  [TX]│ │L C[R] [TX F2]│ │L[C]R ●TX    │ │
│    │ 59.500 Command tuned │ └────────────┘ └──────────────┘ └─────────────┘ │
│    │ …                    │ ┌ + Tune more ┐                                 │
│    │ (T) Toby  mic✓ keys✓ │                                                 │
└────┴──────────────────────┴───────────────────────────────────────────────┘
```

**Overlay:** top-left pill `TX 62.100 Alpha FT` (red border while keyed), and below it one small pill per active speaker: `● Rhys 59.500`. Semi-transparent, blurred, click-through. Position, size and opacity in settings.

**Still to design (M3):** settings (devices, mic test meter, noise suppression, blips on/off), keybind recorder, members screen (promote, remove, rotate invite), tray menu, empty/error states (server down, mic blocked, channel deleted).
