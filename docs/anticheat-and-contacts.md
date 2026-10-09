# Anti-cheat risk, dev contacts, and lower-risk designs (checked 9 Oct 2026, NZ time)

## 1. Who to contact (verified)

| # | Channel | Address | Why / notes |
|---|---|---|---|
| 1 | **Bulkhead support email** (best for a written answer) | **support@bulkhead.com** | Official "General and safety enquiries" on [wardogs.com/safety](https://www.wardogs.com/safety); the enforcement policy says "Questions about anything here go to support@bulkhead.com" ([wardogs.com/enforcement](https://www.wardogs.com/enforcement)). Bulkhead runs the anti-cheat and applies bans. |
| 2 | **Team17 player support portal** (ticket = written record) | [team17.com/support](https://www.team17.com/support) → WARDOGS tile → [support.team17.com](https://support.team17.com/) | Team17 is the publisher; its support staff answer WARDOGS tickets and Steam threads (e.g. the [Vivox thread](https://steamcommunity.com/app/1867240/discussions/3/571549538645524618/)). |
| 3 | **Official WARDOGS Discord** | [discord.com/invite/playwardogs](https://discord.com/invite/playwardogs) (invite live; server "WARDOGS") | Good for getting a community manager's attention and pointing them at the email/ticket. Not a written confirmation on its own. |
| 4 | **Steam discussions** | [steamcommunity.com/app/1867240/discussions](https://steamcommunity.com/app/1867240/discussions/) | Bulkhead devs post here (e.g. the pinned Linux statement by "KingHoward (Bulkhead)"). Public; others would see the answer. |
| 5 | Official community portal | [community.wardogs.com](https://community.wardogs.com/) | Playtest sign-ups / account linking. Not a support channel. |
| — | Elytra (VAIIYA Corp) | No public third-party/developer contact found | Elytra is built by VAIIYA for Embark ([Embark via GamingOnLinux](https://www.gamingonlinux.com/2026/08/the-finals-will-be-adding-a-new-elytra-anti-cheat/)). [vaiiya.org/help](https://vaiiya.org/help) only has an "anomaly report" form and is styled as THE FINALS in-game branding; Embark's [Elytra help page](https://id.embark.games/the-finals/support/faq/261-installing-elytra-anti-cheat) covers Embark games only. **Go through Bulkhead**; they can ask their provider. |

Set expectations: the enforcement page says "We don't publish the detail of how detection works, and we won't discuss it in individual cases." A general "that's fine, it doesn't touch the game" is the realistic best case; a formal whitelist is unlikely.

## 2. What is publicly known

**WARDOGS / Bulkhead (official):**
- Steam lists Elytra, kernel-level. The privacy policy also names an **Anybrain SDK collecting keyboard and mouse input telemetry** and Zero IT Lab integrity telemetry ([summary with sources](https://wardogsgame.net/anti-cheat/)).
- Detection includes "monitoring applications running on your machine during gameplay" and "analysing input and gameplay patterns" ([enforcement](https://www.wardogs.com/enforcement)).
- Banned: "Using macros, scripts or hardware devices to automate inputs or gain an advantage that normal play doesn't allow"; tampering with game files/memory; interfering with the anti-cheat. EULA: "tools that simulate or replace human input" and "unauthorised third-party software in connection with the Services" ([macros FAQ quoting the EULA](https://wardogshub.gg/faq/macros-voiceattack/)).
- Nothing official names overlays, Discord/OBS overlays, voice apps or hotkey tools either way. No whitelist published. No reported bans for voice/overlay apps found. Launch had a batch of wrong bans that were later rescinded ([wardogsgame.net](https://wardogsgame.net/anti-cheat/)). Permanent bans are usually paired with hardware bans; only permanent account bans can be appealed (appeal@bulkhead.com).
- Elytra conflicted with GeForce NOW at launch (VM/cloud environment refused) ([wardogshub.gg](https://wardogshub.gg/anti-cheat/)). Players report conflicts with other kernel anti-cheats (Vanguard) running at the same time.

**Our app vs those rules:** Radio Net never touches the game process, files or memory, never sends input (no SendInput), and PTT is a human key press used only by our app. So on the written rules it is a voice app, not a macro. The risk is a **heuristic/false-positive**, not a rule breach.

**Comparable anti-cheats (public statements are thin):**
- BattlEye FAQ: bans only for "actual cheats/hacks"; "non-cheat overlays ... are generally supported"; may "kick (not ban)" for specific programs "such as macro tools" ([battleye.ltd/support/faq](https://www.battleye.ltd/support/faq/)).
- EAC / Vanguard: no public statement found that names `WH_KEYBOARD_LL`/`WH_MOUSE_LL`, `RegisterHotKey`, Raw Input or topmost windows. Discord, TeamSpeak, Mumble and OBS all run beside kernel anti-cheat games daily.
- Separate topmost click-through windows are drawn by Windows (DWM), not inside the game; injected overlays (Discord/Steam/NVIDIA) hook the game's renderer and are vendor-whitelisted. Ours is the non-injected kind (lower risk). Secondary sources: [Backgrind](https://backgrind.com/overlay-anticheat-checker/the-finals/), [EdgeDrop](https://www.edgedrop.app/blog/anti-cheat-overlays-and-why-less-is-safer) (vendor blogs, not anti-cheat statements). EdgeDrop claims anti-cheats treat LL hooks as "keylogger-like" and recommends RegisterHotKey; unverified but plausible, especially with Anybrain watching input.
- Mumble moved Windows hotkeys **from LL hooks to Raw Input** in 1.4 because hooks sit "between the devices and the rest of the system" (mouse polling drops, lag) ([mumble #4039](https://github.com/mumble-voip/mumble/issues/4039), [PR #4941](https://github.com/mumble-voip/mumble/pull/4941)). Raw Input needs UI Access if the game runs elevated.
- Discord needed a signed admin "System Helper" so keybinds work in **elevated** games ([Discord support](https://support.discord.com/hc/en-us/articles/34853435033367-Discord-System-Helper)). Windows UIPI blocks lower-integrity apps from seeing input aimed at elevated windows, whichever API we use. Test if WARDOGS runs elevated.

**Is it "the hotkey thing" specifically?** Mostly, yes. The current spike uses `uiohook-napi`, which installs global low-level keyboard + mouse hooks (`SetWindowsHookEx WH_KEYBOARD_LL/WH_MOUSE_LL`). That is the same mechanism keyloggers and some macro tools use, and it sits in the input path that Anybrain analyses. It's the part most likely to look suspicious. The overlay is a smaller risk, and the voice/network part is none.

## 3. Draft message (not sent)

**To:** support@bulkhead.com (and/or a Team17 WARDOGS ticket)
**Subject:** Third-party voice/radio app with WARDOGS: anti-cheat check before we test

> Hi Bulkhead team,
>
> I run a small NZ WARDOGS community. We're building a free, private voice "radio" app for our group: a separate Windows program (not a mod) that lets players listen to several radio channels and talk on one with push-to-talk, a bit like Discord or TeamSpeak.
>
> Before anyone tests it with the game, we want to make sure it won't cause problems with your anti-cheat. What it does:
> - Runs as its own process. It never opens, reads or writes the WARDOGS process, memory or files.
> - Push-to-talk on a key or mouse button (e.g. Mouse 4). It only *reads* the button to know when to transmit; it never sends or automates any input to the game.
> - Optional small always-on-top, click-through window showing which channel you're talking on (a normal Windows window, not injected into the game; needs borderless windowed).
> - Voice runs through our own server, nothing to do with your Vivox voice chat.
>
> Questions:
> 1. Is a companion app like this allowed with WARDOGS?
> 2. Is there a way to read push-to-talk keys (global keyboard/mouse hook vs Windows Raw Input) or a type of overlay you'd prefer we avoid?
> 3. If we stick to your guidance, is there any way to flag our app (e.g. a signed executable name) so it isn't mistaken for a cheat?
>
> Happy to share the source code or a build if that helps. Thanks for your time.
>
> Tobias
> [community name / Steam profile link]

## 4. Lower-risk designs, ranked (lowest risk with good UX first)

| Rank | Design | Anti-cheat risk | Tradeoffs |
|---|---|---|---|
| 1 | **Raw Input hotkeys** (`RegisterRawInputDevices` with `RIDEV_INPUTSINK`), replacing uiohook | Low: no hook in the input chain; same approach as Mumble 1.4+ | Key down **and** up, mouse buttons incl. Mouse 4/5, multiple devices. Can't swallow the key (the game also sees Mouse 4, which is fine if it's unbound in-game). Needs a small native addon (~1-2 dev days). Elevated-game caveat as above. |
| 2 | **Overlay off by default**; audio cues (TX chirp, spoken channel name on switch), tray icon, optional second-screen/compact window | Removes the overlay risk entirely | Less glanceable mid-fight. Keep the click-through overlay as opt-in once the anti-cheat night is clean. |
| 3 | **Dedicated USB PTT button / foot pedal**, read by our app via Raw Input/HID | Low: our app reads its own device; no global key watching needed | ~NZ$30-80 hardware per person; many cheap pedals pretend to be a keyboard (still fine with Raw Input). The EULA's "hardware devices to automate inputs" line doesn't fit (no game input is automated), but worth naming in the email. |
| 4 | **Phone as PTT** (big button in a web page/app on the phone, talks to the desktop app or straight to LiveKit) | Lowest on the PC: zero input footprint | Awkward with hands on mouse/keyboard; extra latency; phone has to be on the desk. Good fallback for nervous testers. |
| 5 | **RegisterHotKey** (Electron `globalShortcut`) | Low: standard OS API | Keyboard only (no mouse buttons); fires on press only, so PTT release needs `GetAsyncKeyState` polling; **swallows the key** so the game never sees it. Workable as "toggle to talk". |
| — | Current: uiohook LL hooks | Highest of these (keylogger-like signal, in the input path) | Best UX (any key/mouse, up/down). Keep only as an opt-in "advanced" mode, if at all. |

Suggested path: switch to Raw Input + overlay off for the M1 anti-cheat night, and email Bulkhead in parallel. The test still needs one throwaway or willing account, because Bulkhead won't promise anything in advance.
