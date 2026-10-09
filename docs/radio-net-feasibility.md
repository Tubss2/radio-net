# Radio-net voice comms for milsim gaming: feasibility study

*Prepared 8 Oct 2026 (NZ time). Focus game: WARDOGS. Applies to most PC games.*

## TL;DR

- **The thing you want already exists, just not inside Discord.** "Listen to many nets, talk on one, separate push-to-talk per net" is built into **Mumble** (free, open source), roughly doable in **TeamSpeak** (whisper lists), and is the core feature of **Sonoran Radio** (a commercial "radio" app with a desktop overlay that works over any game). **SimpleRadio Standalone (SRS)** from the DCS flight-sim world can also run with no game attached.
- **WARDOGS has no SDK, no mod support and no plugin hooks**, and it uses a kernel-level anti-cheat (Elytra). So any solution has to be **game-agnostic**: a separate voice app running next to the game. That rules out Arma-style "radio tied to an in-game item" realism such as range, terrain and jamming, but the net structure works fine.
- **Discord can't do this properly.** One account can only sit in one voice channel. Bots can relay audio between channels in fixed patterns, but they can't give each player their own "tune these nets, transmit on that one" setup. Client mods break Discord's Terms. The only Discord-native workaround is running Discord Stable, PTB and Canary side by side, each logged into a different account. It works, but it's clunky.
- **Quickest win: a Mumble server set up as a radio net** (an evening's work, free or about US$5–10 a month for a server). **Easiest polished option: trial Sonoran Radio** (free up to 10 users). **A custom app is very doable** (desktop app + LiveKit or Mumble backend, Discord login for roles), but it only pays off if you want Arma-feel features such as a radio cycle key, radio effects and left/right-ear radios across many games.

---

## 0. What WARDOGS actually is (and what it allows)

| Item | Finding | Source |
|---|---|---|
| Game | 100-player, 3-team "all-out warfare" tactical FPS. Developer **BULKHEAD**, publisher **Team17**. Steam Early Access since **10 Sep 2026**, Windows only. | [Steam](https://store.steampowered.com/app/1867240/WARDOGS/), [Team17](https://www.team17.com/games/wardogs) |
| Built-in voice | Two built-in VoIP channels: **Squad voice** (whole squad, any distance; default PTT **J**) and **Proximity voice** (nearby players, enemies included; default PTT **K**). No radio item, no frequencies. | [Steam](https://store.steampowered.com/app/1867240/WARDOGS/), community guides: [wardogs-wiki.org](https://wardogs-wiki.org/guides/controls-and-voice-chat), [wardogsloadout.wiki](https://wardogsloadout.wiki/guides/wardogs-how-to-play/) |
| Engine | Unreal Engine 5 with BULKHEAD's custom "War Dynamics Framework" layer. | [wardogs-game.com](https://wardogs-game.com/guides/wardogs-game-engine), [wardogsintel.com](https://wardogsintel.com/en/systems/war-dynamics-framework) |
| Modding / SDK / plugins | **None announced** as of late Sep 2026: no mod tools, no Workshop, no server code. Community servers are rented through approved hosts and only offer RCON map/mode control. I found **no positional-audio API or "Mumble Link"-style hook**. | [wardogshub.gg mod FAQ](https://wardogshub.gg/faq/mod-support/) |
| Anti-cheat | **Elytra, kernel-level** (switched from Easy Anti-Cheat in Sept 2026). The official enforcement policy says the anti-cheat monitors "applications running on your machine during gameplay" and bans "macros, scripts or hardware devices to automate inputs". | [wardogshub.gg anti-cheat](https://wardogshub.gg/anti-cheat/), [wardogs.com/enforcement](https://www.wardogs.com/enforcement) |

**Caveat:** several WARDOGS "wiki" sites are unofficial fan or SEO sites. Steam, Team17 and wardogs.com are the authoritative sources. The voice keybinds and the absence of mod tools are consistent across all of them.

**What this means:** nothing can plug into WARDOGS itself. The realistic model is to keep using the in-game squad and proximity voice for local stuff and run a separate radio app for the nets. Push-to-talk keys must not clash with the game's (J/K by default).

### Reference: how Arma Reforger does it
Press **G** for a radial menu and pick which of your two tuned channels is "active". You hear both but only transmit on the active one. Hold **Caps Lock** to transmit, double-tap Caps Lock to swap channels, Q/E steps through preset platoon/group frequencies. A manpack radio can get its own PTT (**Ctrl+Caps**). Mods add per-channel PTT keys. ([Bohemia "Boot Camp – Communications"](https://reforger.armaplatform.com/news/boot-camp-communications))

That gives the target feature list: **(a)** monitor several nets at once, **(b)** choose the transmit net (a cycle key or a dedicated PTT per net), **(c)** restrict who can join which net, **(d)** nice-to-haves: radio sound effect, per-net volume, left/right ear per radio.

---

## 1. Existing tools

### 1a. Mumble (free, open source, self-hosted)
- **Listen to many:** "Channel Listeners" (since 1.4) let you *listen to* any number of channels without joining them, with a separate volume per listened channel. Listeners are visible to others (an "ear" icon) and can be restricted with ACLs. So riflemen can be blocked from listening to Command. Listeners and their volumes are saved for registered users since 1.5. ([Mumble 1.4 notes](https://www.mumble.info/blog/first-mumble-1.4.0-development-snapshot/), [Mumble 1.5.634 notes](https://www.mumble.info/blog/mumble-1.5.634/), [ACL docs](https://www.mumble.info/documentation/administration/acl/))
- **Talk on one / PTT per net:** your normal PTT talks into the channel you're in, and you can add extra **Whisper/Shout shortcuts** that target a specific channel, optionally including linked channels and sub-channels. So you get "Caps = my fire team, Mouse4 = Command net, Mouse5 = Arty net", which is closer to Reforger's manpack and ACRE's multi-PTT than to a single cycle key. ([Goon wiki Mumble guide](https://wiki.goonswarm.org/w/Mumble), [EVE LinkNet guide](https://wiki.eve-linknet.com/tools/communication/mumble), [Brave Collective guide](https://wiki.bravecollective.com/public/alliance/it/communication-resources)). EVE Online alliances have run large fleets this way for years.
- **Gaps:** there's no built-in "press G to cycle transmit radio", no radio sound effect, and no per-net left/right panning (Mumble's positional audio needs game support, which WARDOGS doesn't have). Its in-game overlay has historically been blocked by some anti-cheats (BattlEye is listed as a known issue in the 1.4 notes). Don't use the overlay with WARDOGS. The separate "TalkingUI" window (shows who is talking on which channel) is safer.
- **Cost / effort:** client and server are free. Self-host on any small VPS (ideally Sydney or Auckland for NZ latency) or a hosted Mumble provider. Setup takes an evening: build the channel tree and ACLs, then give players a short "bind these keys" guide.
- **Game integration needed?** No. Fully game-agnostic.

### 1b. TeamSpeak 3 / 6 (+ whisper lists)
- **Whisper lists** bind a hotkey that talks to chosen channels, groups or users while you stay in your own channel. The classic milsim pattern is **"Channel Commander"**: squad leaders tick Channel Commander, and a whisper hotkey targeting "all channel commanders" becomes a command net. ([Badger's TS guide](http://badgerteamspeak.blogspot.com/2014/03/teamspeak-3-whisper-lists-and-channel.html), [Channel Commander guide](https://medium.com/@jolis/guide-w-pictures-channel-commander-for-teamspeak-3-in-10-easy-steps-d818c976ac78), [TS6 whisper thread](https://community.teamspeak.com/t/toggle-whisper-on-off/56805))
- **Listen to many:** weaker than Mumble. You hear your own channel plus whatever is whispered to you. There's no general "monitor channel X" feature, so a separate net only reaches people who are *targets* of the sender's whisper list. That's fine for a command net, clunky for "anyone who tunes to Arty".
- **Plugins:** TFAR and ACRE2 are TS3 plugins (see 1c). The plugin SDK is for TS3. **TeamSpeak 6 is still in beta** and TS3 plugins aren't generally compatible with it. ([TeamSpeak downloads](https://www.teamspeak.com/en/downloads/))
- **Cost:** a self-hosted TS3 server is free for 1 virtual server / 32 slots. The free 512-slot non-profit licence is no longer issued, and paid licences cost more. ([TS support](https://support.teamspeak.com/hc/en-us/articles/360002712958-How-do-I-set-up-my-own-non-commercial-TS3-server), [licence types](https://support.teamspeak.com/hc/en-us/articles/26033788383261-What-licenses-are-available))
- **Game-agnostic?** Yes. It's a good choice if the group already knows TeamSpeak.

### 1c. TFAR and ACRE2 (Arma 3)
The gold standard for realistic radios (frequencies, short- and long-range sets, left/right ear, terrain-based range, separate PTT per radio). But they **only work with Arma 3**: they need the Arma mod running and talking to a TeamSpeak 3 plugin, which reads radio state from the game. ACRE2's Mumble support is an unfinished development branch. **Not usable for WARDOGS or other games.** ([TFAR GitHub](https://github.com/michail-nikolaev/task-force-arma-3-radio), [ACRE2 install](https://github.com/IDI-Systems/acre2/blob/master/docs/wiki/user/installation.md), [ACRE2 Mumble PR](https://github.com/IDI-Systems/acre2/pull/980), [ACRE2 multi-PTT API](https://acre2.idi-systems.com/wiki/frameworks/functions-list))

### 1d. SimpleRadio Standalone (SRS, from DCS World)
- A standalone radio VoIP client and server (no TeamSpeak needed). Its **External AWACS Mode (EAM)** connects you *without being in DCS*. The wiki explicitly says you can "even use it with a completely different game." ([SRS wiki – General](https://github.com/ciribob/DCS-SimpleRadioStandalone/wiki/General), [EAM release notes](https://github.com/ciribob/DCS-SimpleRadioStandalone/releases/tag/1.5.3.2))
- In EAM you get a panel of several radios, each tuned to a frequency and all audible at once. You select the active radio by keybind (a "radio switch works as PTT" option is available), and there's simultaneous transmit on several radios. Radios, names and channel presets can be customised (`awacs-radios-custom.json`, channel text files). ([SRS Presets](https://github.com/ciribob/DCS-SimpleRadioStandalone/wiki/Presets), [SRS Home](https://github.com/ciribob/DCS-SimpleRadioStandalone/wiki))
- **Feel:** the closest free thing to "tune a radio, hear everything tuned, pick which radio you transmit on", with radio-style audio.
- **Caveats:** Windows only, and the server needs port 5002 TCP/UDP forwarded or a VPS ([SRS server](https://github.com/ciribob/DCS-SimpleRadioStandalone/wiki/SRS-Server-(WIP))). The UI is aircraft/AWACS-flavoured (AM/FM, MHz). Access control is coarse (coalition passwords), so there's **no per-net permissions**: anyone can tune to "Command" if they know the frequency. Using it outside DCS is a supported side feature, not the main use case. Worth a test night, but I haven't seen reports of infantry groups using it long-term.

### 1e. Sonoran Radio (commercial, purpose-built "radio" app)
- Built mainly for FiveM/GTA roleplay police dispatch, but it has a **desktop app with a radio overlay "while playing FiveM, Arma 3, Roblox, and other games"** and works without game integration (integration only adds things like signal and towers). ([Sonoran Radio](https://docs.sonoransoftware.com/radio), [Radio Overlay docs](https://docs.sonoransoftware.com/radio/tutorials/usage/desktop-overlay.md))
- **Listen to many / transmit on one:** yes. "Scan" (listen to) multiple channels while transmitting on a primary channel (Ctrl-click to transmit on several). There are hotkeys for PTT, **temporary per-channel PTT**, changing channel, and changing channel group. Admins configure channels and permissions centrally from a dispatch/admin panel. ([Dispatch panel docs](https://docs.sonoransoftware.com/radio/tutorials/usage/dispatch-panel/using-the-dispatch-panel.md))
- **Cost:** Free (10 connected users), Plus US$14.99/mo (30 users), Pro US$19.99/mo (unlimited users, custom radio frames). 25% off quarterly. ([Pricing](https://docs.sonoransoftware.com/radio/pricing/pricing-faq/standalone-pricing.md))
- **Caveats:** the branding and features are aimed at police/fire roleplay. The "overlay" is the desktop app's own window placed over the game, so check it behaves in fullscreen and with Elytra (it has a "focus radio" hotkey for fullscreen). I haven't verified how it behaves with WARDOGS. **This is the most "off-the-shelf radio net" option found.**

### 1f. TACCOM (hardware radio for games)
A real US-made handheld "radio" (from US$99, waitlist / sold by invitation) with physical knobs, private frequencies and multi-frequency monitoring, aimed at flight and space sims (DCS, EVE, Star Citizen, Nuclear Option). Interesting, but it's a hardware purchase per person, shipping to NZ is unknown, and it uses a message-queue design (transmissions play one at a time, capped at about 10 s). That's great for big public nets, less so for fast infantry chatter. ([taccom.io](https://taccom.io/))

### 1g. Zello (walkie-talkie app)
Generic multi-channel PTT walkie-talkie for phone and PC. Not game-focused. Could serve as a phone-based "command net" in a pinch. ([Google Play](https://play.google.com/store/apps/details?hl=en_US&id=com.loudtalks)). I didn't evaluate it in depth.

### 1h. Discord-based options
- **Relay/bridge bots:** e.g. open-source [go-discord-caller](https://github.com/sealbro/go-discord-caller/) (one caller broadcast to many channels, hub-and-spoke, or full multi-channel conference with "mix-minus" so you don't hear yourself echoed back), the [Orax bot](https://docs.oraxbot.com/features/voice-channels) (beta: bridges linked voice channels, even across servers), and a documented [one-to-many broadcast architecture](https://zva.bio/projects/discord-voice-broadcast). These give **fixed topologies**, e.g. "Platoon leader's voice is piped into every fire-team channel". They don't give each player their own choice of nets. See section 2.
- **Multiple Discord clients:** Discord officially ships Stable, **PTB** and **Canary** builds that run side by side with separate settings ([Discord Testing Clients](https://support.discord.com/hc/en-us/articles/360035675191-Discord-Testing-Clients)). Log each into a *different* account, join a different voice channel in each, and set a different PTT key in each ([PTT docs](https://support.discord.com/hc/en-us/articles/211376518-Voice-Input-Modes-101-Push-to-Talk-Voice-Activated)). Result: up to 3 nets, each with its own PTT. This is manual use of official clients, not botting, so I see no ToS problem. But you need alt accounts, you show up as several people, and it's fiddly. A realistic workaround for squad leaders only.
- **VoiceMeeter-style hacks:** only needed if you want to split which mic goes to which client or route audio to different ears. They add complexity and don't solve anything the multi-client trick doesn't.

### 1i. Voice SDKs (building blocks, not finished apps)
- **Vivox (Unity):** a player can join multiple channels and choose transmission mode (single channel / all / none). Free up to 5,000 peak concurrent users per month. ([Transmission modes](https://docs.unity.com/en-us/vivox-unity/developer-guide/transmission/transmission-modes), [pricing FAQ](https://support.unity.com/hc/en-us/articles/31045802890260-Vivox-Pricing-and-Billing-FAQ))
- **ODIN (4Players):** clients can join multiple rooms at once, and the product markets "radio channels". The free tier (25 PCU) is described as "free for development". Paid plans start around €49/month. ([ODIN concepts](https://docs.4players.io/voice/introduction/structure/), [pricing](https://odin.4players.io/pricing/))
- **LiveKit:** open-source WebRTC SFU (self-host free) or LiveKit Cloud (free 5,000 participant-minutes a month, then the Ship plan from US$50/mo). ([pricing](https://livekit.com/pricing))
- **Discord Social SDK:** see section 2.

### 1j. Other things checked
- **Ventrilo:** legacy, and I found nothing suggesting it beats Mumble or TeamSpeak here. Not recommended.
- **Overwolf:** I found **no** Overwolf app that provides multi-net radio comms. Overwolf overlays also inject into games, which is risky with kernel anti-cheat.
- **Built-in game radios** (Arma Reforger, Squad's command channel, etc.) only exist inside those games.

### Comparison table

| Tool | Listen to many nets | Pick transmit net / PTT per net | Who-can-join controls | Radio "feel" | Cost | Platform | Setup effort | Works with WARDOGS (no integration)? |
|---|---|---|---|---|---|---|---|---|
| **Mumble** | ✅ Channel Listeners (per-net volume) | ✅ Normal PTT + Shout-to-channel hotkeys (one key per net) | ✅ Strong ACLs, including who may listen | ❌ No effects, no cycle key | Free; ~US$5–10/mo VPS | Win/Mac/Linux/mobile | Low–medium (one evening) | ✅ Yes |
| **TeamSpeak 3/6** | ⚠️ Only own channel + whispers aimed at you | ✅ Whisper-list hotkeys (e.g. Channel Commander net) | ✅ Groups/permissions | ❌ (RadioFX-type plugins TS3 only) | Free ≤32 slots; paid above | Win/Mac/Linux | Medium | ✅ Yes |
| **TFAR / ACRE2** | ✅ | ✅ | ✅ (in-game) | ✅✅ Best | Free | Arma 3 + TS3 | Medium | ❌ Arma 3 only |
| **SRS (EAM mode)** | ✅ Multiple tuned radios | ✅ Select radio by key; radio-switch-as-PTT option | ⚠️ Coalition passwords only | ✅ Radio-style | Free (open source) | Windows | Medium (server/ports) | ✅ Officially "can be used with a different game"; untested by me |
| **Sonoran Radio** | ✅ Scan multiple channels | ✅ Primary transmit + per-channel PTT hotkeys | ✅ Admin panel | ✅ Radio overlay/frames | Free ≤10; US$14.99 ≤30; US$19.99 unlimited | Desktop app + web/mobile | Low | ✅ Overlay "for any game" (verify with Elytra) |
| **TACCOM** | ✅ (v2 multi-frequency) | ✅ Physical PTT/knobs | ✅ Private frequencies | ✅✅ Physical radio | From US$99 per person + shipping | Hardware | Low (per unit) | ✅ But queued, ≤10 s messages |
| **Discord multi-client** | ⚠️ Up to 3 (one per client) | ✅ Separate PTT per client | ✅ Discord roles | ❌ | Free (needs alt accounts) | Win/Mac/Linux | Low but clunky | ✅ Yes |
| **Discord relay bots** | ⚠️ Fixed bridges only | ❌ Not per user | ✅ Channel perms | ❌ | Free/self-host | Server | Medium–high | ✅ But doesn't meet the core need |
| **Zello** | ✅ | ✅ | ✅ | ⚠️ Walkie-talkie | Free tier | Phone/PC | Low | ✅ (not game-oriented) |

---

## 2. Can it be done inside Discord?

**Short answer: not properly, not with normal Discord clients.** Details:

1. **One voice channel per account.** A normal Discord account can only be connected to one voice channel at a time (per client), and each channel has a single shared audio mix: everyone in it hears the same thing. "I hear Command + FT1, my rifleman hears only FT1" therefore can't be expressed in plain channels.
2. **What bots can do.** A bot account can also only sit in one voice channel per server, so relays use **one bot per channel** plus a coordinating process ([architecture write-up](https://zva.bio/projects/discord-voice-broadcast), [go-discord-caller](https://github.com/sealbro/go-discord-caller/)). This works for **fixed patterns**:
   - one-way broadcast: Platoon/Command channel → every fire-team channel;
   - hub-and-spoke: a commander hears all fire teams, each team hears only the commander;
   - a full conference bridge between channels.

   It **can't** do per-player tuning, because the bot plays into a channel and everyone in that channel hears it. Per-player routing would mean one private channel and one bot *per player*, which falls apart quickly. "Transmit-net switching" would mean a bot moving you between channels (bots can move members), but then you stop hearing your old channel.
3. **Receiving voice is unofficial and now encrypted.** discord.js says audio receive "is not documented by Discord so stable support is not guaranteed" ([@discordjs/voice](https://discord.js.org/docs/packages/voice/main)). Since **2 March 2026 every Discord voice call is end-to-end encrypted (DAVE)** and bots must implement DAVE to join at all ([Discord blog](https://discord.com:2053/blog/every-voice-and-video-call-on-discord-is-now-end-to-end-encrypted), [support article](https://support.discord.com/hc/en-us/articles/38025123604631-Minimum-Client-Version-Requirements-for-Voice-Chat)). Libraries handle this today, but it adds fragility.
4. **Latency and quality.** A relay decodes, mixes and re-encodes audio through extra hops (bot → relay → bot). I didn't measure it, but expect noticeably more delay than a direct call, plus occasional glitches when bots reconnect. That's tolerable for announcements, not ideal for fast back-and-forth.
5. **Discord Activities (Embedded App SDK):** Activities run in a sandboxed iframe and **can't access the microphone or raw voice audio**, only "who is speaking" events. ([Embedded App SDK](https://docs.discord.com/developers/developer-tools/embedded-app-sdk), [mic-access feature request](https://github.com/discord/embedded-app-sdk/issues/363)). Not a route.
6. **Discord Social SDK: the interesting one.** Unlike the Discord app, the SDK *"supports being in multiple simultaneous voice calls"*, with **per-call self-mute**, per-participant volume and raw audio callbacks ([Managing Voice Chat](https://docs.discord.com/developers/discord-social-sdk/development-guides/managing-voice-chat)). That's exactly the radio-net primitive: join N lobby calls and unmute only in the transmit net while PTT is held. **But:**
   - calls happen in SDK "lobbies", **not** normal server voice channels, so people in the regular Discord app wouldn't be on the net;
   - it's designed for **games**: development use is rate-limited (e.g. 100 lobby create/join operations per 2 hours per app), and production access requires account linking, Rich Presence, game invites and a full Discord friends list, followed by Discord review ([Communication Features](https://docs.discord.com/developers/discord-social-sdk/core-concepts/communication-features));
   - it's unclear whether Discord would approve a stand-alone "radio companion app" that isn't a game. **Unverified.** A small private group might get by within development limits, but that's a grey area.
7. **Client mods (Vencord/BetterDiscord):** Discord's Terms forbid modifying its software and "using any unauthorized software designed to modify the services" ([Discord Terms](https://discord.com/terms)). Bans for plain mod use appear rare, but a mod that opens extra voice connections would look like automation. **Self-bots** (automating user accounts, e.g. alt accounts joining extra channels by script) are explicitly prohibited and can get accounts terminated ([Discord support](https://support.discord.com/hc/en-us/articles/115002192352-Automated-User-Accounts-Self-Bots)). **Not recommended.**

**Verdict:** Discord is great for identity, roles and text, and fine for a *fixed* "command broadcast into team channels" bot. It is **not** a sensible base for per-player radio nets. The best "Discord integration" is to **use Discord login and roles to decide who may join which net** in a separate voice app, and keep Discord for everything else. For a few squad leaders, the Stable/PTB/Canary multi-client trick works today with zero development.

---

## 3. Building it from scratch

### Architecture sketch
```
[Desktop client (Windows first)]                [Voice backend]
 - Login with Discord (OAuth) -> roles/nets      - Option A: Mumble server (channels = nets,
 - Radio panel: Radio 1..N, each tuned to a net    ACLs = permissions, client speaks Mumble protocol)
 - Subscribe (listen) to all tuned nets           - Option B: LiveKit SFU (self-host or Cloud):
 - Publish mic ONLY to active net while PTT held    1 room per net, or 1 room + per-track
 - Global hotkeys: PTT, per-radio PTT,              subscription rules
   "cycle active radio" (the Reforger G key)      - Small API: issues access tokens per net
 - Per-radio volume + left/right ear pan            based on Discord roles (command net = SL role)
 - Radio FX: band-pass (~300–3,000 Hz), light
   distortion, squelch click/tones on key/unkey
 - Small always-on-top status window (NOT an
   in-game injected overlay)
```
- **Frequency = room/channel.** "Tuning" means subscribing. "Transmit" means publishing your mic to exactly one room (or several, if you want simultaneous transmit like SRS).
- **Push-to-talk needs key-down *and* key-up events.** Some frameworks' "global shortcut" APIs only report the key press, so plan on a native keyboard hook library. Discord, TeamSpeak and Mumble all do the same thing.
- **Game-agnostic by design.** Nothing touches the game process. The optional "game awareness" layer (e.g. auto-mute in menus) is only possible where games offer an API, and WARDOGS doesn't.

### Effort and cost tiers (rough estimates, not quotes)

| Tier | What you get | Effort | Running cost |
|---|---|---|---|
| **0. Configure, don't build** | Mumble server with nets, ACLs, listeners and per-net shout keys, plus a one-page setup guide/config | One evening | Free to ~US$5–10/mo VPS |
| **1. Weekend prototype** | A small helper app driving an existing Mumble client or a Mumble protocol library: "cycle radio" key that changes the shout target, a talking-on-which-net status window | A weekend to a week for a hobbyist dev | Same as above |
| **2. Proper MVP** | Own desktop client (e.g. Tauri/Electron or native) on LiveKit or Mumble: radio panel, Discord login, role-based nets, per-radio volume/pan, radio FX, cycle + per-radio PTT | ~2–6 weeks for one experienced dev | Self-hosted LiveKit/Mumble on a NZ/AU VPS ~US$10–20/mo. LiveKit Cloud free tier is 5,000 participant-minutes/mo; a 20-person, 3-hour op is 3,600 minutes even if each person counts once, more if each net connection counts, so a real group would soon need the paid plan (US$50/mo+) or self-hosting |
| **3. Polished product** | Installer, auto-update, code signing, admin web panel, net presets per game/op, recordings/after-action review, mobile listen-only, multi-community | ~2–4+ months | Hosting scales with users. Code-signing certificate and support time matter more than servers |

### Anti-cheat considerations (important for WARDOGS)
- **Global hotkeys:** passively listening for a key (how Discord and TeamSpeak do PTT) is standard and widely tolerated. **Never send or simulate input to the game**: WARDOGS' policy bans "macros, scripts or hardware devices to automate inputs" ([enforcement](https://www.wardogs.com/enforcement)).
- **Overlays:** don't inject into the game's renderer (that's how overlays get blocked; Mumble's overlay has been blocked by BattlEye before). Use a separate always-on-top window, or audio cues only (beeps when you switch radio).
- **Kernel AC monitors running apps.** A normal voice app shouldn't be a problem, but nobody can guarantee what Elytra flags. Test with a throwaway account first if possible, and avoid anything that reads game memory or hooks the process.
- **Windows only** for WARDOGS anyway (no Linux/Proton support at launch).

---

## 4. Recommendation (ranked)

1. **Quickest win, this week: Mumble set up as a radio net.** (Game-agnostic, free.)
   - Channels: `COMMAND`, `ARTY`, `LOGI`, `FT-1`, `FT-2`… ACLs so only the SL role can join or listen to COMMAND.
   - Each player *sits in* their fire-team channel (normal PTT) and *listens to* whatever extra nets their role allows. Leaders get extra keys: e.g. Mouse4 = shout to COMMAND, Mouse5 = shout to ARTY.
   - Keep WARDOGS' own squad (J) and proximity (K) voice for in-game local comms. Pick Mumble keys that don't clash.
   - Host on a small Sydney/Auckland VPS or a hosted Mumble provider.
   - *Alternative quick test:* one evening on **SRS in EAM mode** to see whether its "tuned radios" feel is preferred. It's free but has weaker access control.
2. **Best mid-term / least DIY: trial Sonoran Radio.** It already has scan-many + transmit-one + per-channel PTT + an admin panel + a radio overlay for any game. Free for up to 10 people, US$14.99/mo up to 30. Run a test night to check fullscreen behaviour with Elytra and whether the police-RP flavour bothers anyone. If the group already lives in TeamSpeak, **TeamSpeak whisper lists / Channel Commander** is the zero-cost alternative for a command net.
3. **Discord stop-gap (no new app):** squad leaders run Discord Stable + PTB (+ Canary) with alt accounts so they can sit in their team channel *and* a Command channel with separate PTT keys. Optionally add a relay bot to push Command announcements into team channels one-way. Don't use client mods or self-bots.
4. **Custom build, only if 1–2 feel too clunky:** a game-agnostic desktop "radio" client on **LiveKit or Mumble**, with **Discord login and roles** deciding who may join which net, an Arma-style radio panel (tune N radios, **cycle key**, per-radio PTT, left/right ear, radio FX), and a separate status window rather than an in-game overlay. Start with Tier 1 (helper on top of Mumble) to prove the workflow before investing in Tier 2. The Discord Social SDK's multi-call support is tempting as a backend, but its game-oriented approval rules make it a risky foundation. Treat it as unverified.

**Game-agnostic vs integration:** everything recommended (Mumble, TeamSpeak whispers, SRS-EAM, Sonoran overlay, Discord multi-client, a custom client) works across any PC game. Only TFAR/ACRE2 (Arma 3) and Sonoran's location/tower features (FiveM, Arma 3, ER:LC) need game integration, and WARDOGS offers none.

### Open questions / things I couldn't verify
- How Elytra treats Sonoran's overlay window, SRS or Mumble in practice (no reports found either way).
- Whether Discord would approve a non-game radio companion app for Social SDK voice at production scale.
- SRS's long-term usability for infantry-style nets outside DCS (it's documented as possible, but I found no infantry-community case studies).
- Exact relay-bot latency on Discord (not measured).
