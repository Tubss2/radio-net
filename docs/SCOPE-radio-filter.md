# Radio voice filter

Planning only. This note does not change the client, the API, or LiveKit. It describes a filter that makes received voice sound like a radio, and it records one cue the app does not have yet.

Issue [#6](https://github.com/Tubss2/radio-net/issues/6). [`PLAN.md`](PLAN.md) already lists this as backlog, off unless the person turns it on, and outside 0.4.x.

## Summary

Each listener should colour the voice they receive. The chain is Web Audio on the graph that already plays a remote track: a band-pass around 300–3400 Hz, a light saturation (and, on the harsher preset, a light bit reduction), an optional local static bed, and a squelch tail when someone else keys up or releases.

Four presets: **clean**, **handheld**, **vehicle**, **degraded**. Clean is a bypass. It is the default, so a profile that has never chosen a filter keeps today’s voice.

The choice lives on this browser or this PC, next to volume and pan. One default on that profile covers every channel this person tunes. A channel can override it. There is no community preset and no admin preset. Nobody else chooses what this radio sounds like.

Distance or signal-strength colouring can come later as a cosmetic knob. It is separate from range and terrain, which stay out.

## What the code does today

`RadioEngine.tune` in `spike/client/src/renderer/src/lib/radioEngine.ts` opens one `AudioContext`. Each tuned channel gets a `GainNode` into a `StereoPannerNode` into the speakers. Volume, mute, and left/centre/right are already per channel, and the local profile stores them on `RadioPrefs` (`volume`, `muted`, `pan` in `spike/client/src/shared/profile.ts`).

When a remote audio track arrives, Chromium only feeds it into Web Audio if it is also attached to a muted `<audio>` element. The engine does that, then connects `createMediaStreamSource` straight to that channel’s gain. There is no filter node.

A forwarded all-call uses the admin’s own identity. The engine skips that track, so the sender does not hear an echo. Any other remote track, including someone else’s all-call, plays through the same gain and panner.

The microphone is opened with echo cancellation, noise suppression, and auto gain. `outgoingTrack` mixes that mic into a `MediaStreamDestination` and publishes the mix. `playRogerIntoMix` adds two sine tones (1046 Hz, then 1568 Hz, about 180 ms) into that mix, so listeners hear the beep inside the voice. The raw mic still feeds `monitorMic` for the level meter. That meter is a separate analyser and is not on the playback graph.

`RoomEvent.ActiveSpeakersChanged` writes the other people’s names onto the channel. It does not play a sound. The overlay and the last-speaker chips read those names. The overlay payload is capped at 32 speakers, 64-character names, and an opacity from 0 to 1 (`parseOverlayState` in `spike/client/src/shared/ipcValidate.ts`).

### Incoming squelch is missing

There is no start click and no end click when someone else keys up. Nothing in `ActiveSpeakersChanged` calls the sound player. The Sounds panel has no row for it.

Two existing cues are easy to mix up with that click:

- **Add a channel.** `playSquelch` in `spike/client/src/renderer/src/lib/uiSounds.ts` plays `squelch.wav` when this radio adds a channel (`playsAddSquelch` is true only for `add`). Sounds → “Add a channel”. On unless the profile turned it off (`soundsOn !== false`).
- **This radio’s own push-to-talk.** `playPttEdge` plays a 1200 Hz press tone or a 700 Hz release tone, plus the same clip. It runs from this radio’s own key-down and key-up (`ptt` and `holdAllCall`). Sounds → “Push-to-talk press and release”. Off until the profile sets `soundPtt` (`soundPtt === true`).

[`PLAN.md`](PLAN.md) already lists “Incoming transmission start” and “Incoming transmission end” under the 0.5 sounds milestone, and says those sounds are still backlog. [`docs/UI.md`](UI.md) and [`docs/PRIVACY.md`](PRIVACY.md) describe the add-channel clip and the own-PTT cue. They do not describe a click for someone else’s carrier.

The first filter build should add those two cues. They are local, they are off until chosen, and they are separate switches from “Add a channel” and from “Push-to-talk press and release”.

## Listener-side or sender-side

**Listener-side** inserts the chain on each remote track, between the media-stream source and the gain that already does volume:

`source → band-pass → saturation → gain → panner → speakers`

A static bed, when that preset uses one, is a local looping buffer mixed in before the panner. It is not published and it is not a LiveKit participant.

This matches how volume already works. Each person chooses what they hear. Clean is a wire from source to gain. Web and desktop share `RadioEngine`, so they get the same chain.

**Sender-side** would put the same nodes on `outgoingTrack`, before the track is published. Every listener would then hear the sender’s colour, including people on Clean. The roger beep is mixed into that same track, so that colour would ride the beep as well. That takes the choice away from the listener. This design does not do that. The published voice stays the untreated mic, with echo cancellation still on the raw track ahead of the mix. The beep stays in that mix, and each listener’s own preset colours it on the way to their speakers.

## Presets

Missing or unknown means **clean**. Old profiles do not change.

| Preset | What the listener hears |
|---|---|
| **clean** | Bypass. Today’s voice. No static bed. |
| **handheld** | Band-pass about 300–3400 Hz. Light saturation. Little or no static. |
| **vehicle** | A slightly wider pass, about 250–4000 Hz. Less saturation than handheld. No static bed. |
| **degraded** | A narrower pass, about 400–2800 Hz. More saturation and a light bit reduction. Optional static bed under the voice. |

The numbers are the planning targets. The build can trim them after a listen, and it should keep the four names stable so a saved profile still means the same thing.

Bit reduction on **degraded** is the only stage that may need an `AudioWorklet`. A `WaveShaperNode` can do the saturation on every preset. `ScriptProcessorNode` is the wrong tool: it is deprecated and it adds a buffer. If the worklet is awkward in the first build, ship saturation first and add the bit reduction in a follow-up on the same preset name.

The static bed is off on clean, handheld, and vehicle. Degraded may enable it. A person who wants the narrow voice without hiss uses the Sounds switch below, which wins over the preset.

## Where the setting lives

Local profile only.

- `radioFilter: 'clean' | 'handheld' | 'vehicle' | 'degraded'` on the profile. Missing or unknown is `clean`.
- `filter` on `RadioPrefs`, a map of channel id to a preset, the same shape as `volume` and `pan`. A missing channel uses this person’s default.

The control sits with the radio, beside that channel’s volume, plus one choice in Settings for this person’s default. “Use default” on a channel clears the override and follows that personal default. The first build can ship both, because the graph is already one chain per channel and the profile already stores per-channel audio. A default-only first slice is acceptable if the map is still the stored shape, so the per-channel control does not need a migration later.

The preset is never a community setting and never an admin setting. Nothing is sent to the API. `publicCommunity` stays `id`, `name`, `band`, and the invite only when create returns it. No server field, now or later.

## Distance and signal strength

Later, and optional. A future local value can narrow the pass, lower the voice, and raise the static bed. It is a cosmetic flavour on top of the same presets.

[`PLAN.md`](PLAN.md) leaves range and terrain simulation out, and it leaves out anything that reads or hooks the game. This knob must not become that. No positions, no map, no game memory. If it ever exists, a person or a channel sets it by hand.

The first build has no signal-strength control.

## CPU and latency

The voice still arrives on the existing LiveKit path. The filter does not buffer playback and does not add a mouth-to-ear wait.

`BiquadFilterNode` and `WaveShaperNode` are cheap built-ins on the `AudioContext` the engine already runs. One chain per remote audio track is enough: a handful of tuned channels, usually one talker each. The static bed is one local buffer, mixed per channel that asks for it, and it does not cross the network.

The squelch tail is a local cue on the speaker-list edge. It is not a delay inserted in the media path. The release hang (0–400 ms, default 200) stays the roger hang. The filter does not add one.

`monitorMic` stays on the raw microphone. The level meter must keep showing the real input.

## Roger beep

Listeners hear the roger beep inside the remote voice, because `playRogerIntoMix` writes it into the published mix. A listener filter therefore colours the beep the same way it colours the words. Both tones sit inside a 300–3400 Hz pass, so handheld still lets them through, with the preset’s saturation on them. That is the point of a listener chain: the beep sounds like it came through the same radio.

The sender’s “Hear your own roger beep” copy is `playRogerLocal`. It is a separate oscillator on the UI sound context, straight to the speakers. It stays dry. That switch stays off until chosen. The Sounds row “Roger beep” still decides whether the beep is mixed into the transmission. The filter does not replace that switch, and it does not change the hang slider.

A person on Clean hears the beep as it was published. A person on handheld hears the same beep through the filter. The sender does not pick the listener’s preset.

## Sounds, overlay, and the squelch tail

The tail is a Sounds cue, not a hidden part of the preset.

Add two switches, both off until chosen, matching own push-to-talk:

- Incoming transmission start
- Incoming transmission end

They play when `ActiveSpeakersChanged` gains or loses a remote name on a tuned channel. They use the master UI volume (`soundVolume`, default 0.4). They do not reuse `playPttEdge`, which is this radio’s own key. “Add a channel” stays the tune-in clip.

Degraded’s static bed is part of the voice preset. A separate “Static under voice” switch, off unless the preset turned it on, lets someone keep the narrow band and drop the hiss. That hiss is local. It must not be written into the overlay speaker list, and it must not mark the channel as talking. Last-speaker fade stays a display of names.

The overlay payload caps stay as they are. This change does not add a field to overlay state.

Phone and helper push-to-talk only hold the computer’s microphone. They do not play the mix, so they do not grow a filter control. The cue, if the computer’s Sounds switches are on, plays on that computer when the speaker list changes.

## Web and desktop

Web and desktop both run `RadioEngine` in the shared renderer, so the chain, the presets, and the profile fields match. Settings on the web and Options on the desktop already share `SoundsSettings`. The new rows go there. The preset control goes in both shells.

The preview engine is the fake radio. It can store and show the preset. It does not process live audio.

The phone page and the helper stay as they are: they key this computer, they do not hear the community.

## Accessibility

Clean is the easy off switch. It is the default, it is one choice in the preset list, and it removes the band-pass, the saturation, the bit reduction, and the static bed. It is this person’s switch. No community or admin setting can turn the filter on for them.

The incoming start and end clicks ship off. Someone who wants the coloured voice without extra clicks leaves those switches off. The master volume still scales every UI cue, including the new ones, and 0 silences them.

The filter is cosmetic. It must not be required to understand a transmission. Clean keeps the words as LiveKit delivered them.

## Recommendation

Ship a listener-side chain, default **clean**, stored on the local profile with a per-channel override map. Presets are clean, handheld, vehicle, and degraded, with the band-pass and saturation above. Add the missing incoming start and end cues as Sounds switches, off by default. The published voice stays untreated. Signal-strength colouring can come later, still as this person’s own knob.

No API change. No LiveKit change. No server bundle change.

## Open questions

1. Should the first slice include the per-channel override, or only this person’s default with the map reserved?
2. Does degraded’s static bed default on, with a switch to drop it, or default off until the person asks?
3. Are incoming start and end two switches, or one “incoming squelch” switch that covers both edges?
4. Should the tail be the existing `squelch.wav`, a shorter click, or a new clip? The current file is credited for the add-channel cue (JovianSounds, CC0, `CREDITS/SOUNDS.md`).
5. Is a `WaveShaper` grit enough for the first degraded preset, with real bit reduction in a follow-up?

## Out of scope for the first build

No implementation in this change. No sender-side processing. No community preset and no admin preset. No distance, signal strength, range, or terrain. No game hook. No change to the roger hang, the overlay caps, the phone page, or the helper. No extra playback buffer.
