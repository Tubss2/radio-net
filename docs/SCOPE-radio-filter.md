# Radio voice filter

Shipped in the shared renderer. Each listener colours the voice they receive. The choice stays on that browser or that PC. Nothing about it is sent to the API.

Issue [#6](https://github.com/Tubss2/radio-net/issues/6). The approved chain is [`radio-filter/DECISIONS.md`](radio-filter/DECISIONS.md). The numbers the client uses are in [`radio-filter/PARAMETERS.md`](radio-filter/PARAMETERS.md).

## What you hear

Four presets. **Clean** is the default and is a bypass, so a profile that has never chosen a filter keeps today’s voice.

| Preset | What the listener hears |
|---|---|
| **Clean** | The remote voice, unchanged. |
| **Handheld** | Band-pass, a warm soft clip, a quiet hiss under the voice, then level control. |
| **Degraded** | The same chain, driven harder, with a louder hiss. No bitcrush and no extra-narrow band. |
| **Digital** | Codec2 at 2400 bits per second, then a band-pass, a gate, a compressor, and a light clip. No hiss. |

Vehicle is not a preset. An old saved value of `vehicle`, or anything else the client does not know, is read as Clean.

The chain runs on each remote track, between the media-stream source and the gain that already does volume. Clean is a wire from that source to the gain. The other three presets run in one AudioWorklet so the Butterworth curves match the approved demos. Web Audio’s `BiquadFilterNode` band-pass is a different curve, so it is not used for this.

The published microphone is the untreated mic. Echo cancellation, noise suppression, and auto gain stay on that track. The filter never touches what other people receive.

## Where the setting lives

Local profile only, next to volume and pan.

- `radioFilter` on the profile: `clean`, `handheld`, `degraded`, or `digital`. Missing or unknown is `clean`.
- `filter` on that community’s `RadioPrefs`: a map of channel id to one of those four. A missing id follows the profile default. An explicit `clean` is a real override, so a channel can stay clean while the default is Handheld. Choosing **Default** on the channel deletes the override.

The picker is in **Options → Sounds** on the desktop app and in **Settings → Sounds** on the web app. Both use the same panel. Each tuned channel has its own picker beside the volume slider. The compact list has the same control.

There is no community preset and no admin preset. `publicCommunity` is unchanged.

## Transmission cues

The old roger beep (1046 Hz then 1568 Hz, mixed into the sender’s published audio) is gone. `playRogerIntoMix` is not called.

Two cues play on each listener’s own speakers, through the UI sound context, and they are not put through the radio filter:

- **Start**, when someone else begins talking: 494 / 587 / 740 Hz, 44 / 44 / 63 ms.
- **End**, when they stop: 740 / 587 / 440 Hz, 44 / 44 / 75 ms.

Soft square (fundamental + 0.30 × 3rd + 0.12 × 5th), 8 ms fade in, 12 ms fade out, no gap, about −17 dB before the Sounds volume slider. This is v4 `A-down3-long`.

The Sounds switches keep their old storage keys so a saved on/off still applies:

- **Transmission beeps** (`soundRoger`, default on) plays other people’s start and end cues. One cue when the set of people talking gains someone, and one when it loses someone, not a stack of cues if several people key up together.
- **Hear your own** (`soundRogerLocal`, default off) plays the same cues for this radio’s own press and release.

**Release delay** (`hangMs`) keeps the microphone open after you let go. The default is 150 ms. A profile that saved 200 keeps 200. A profile with no `hangMs` becomes 150. The end cue for your own transmission plays after that delay, and only on this machine. Other people hear your voice stop when the muted track drops, and their own radios play the end cue then.

**Add a channel** is still the only squelch. It is unchanged.

## Digital and the licence

Codec2 1.2.0 (commit `06d4c11`) is compiled to a separate `.wasm` file and instantiated inside the worklet. It is LGPL-2.1. The module, the licence, and the rebuild script live in `spike/client/src/renderer/src/audio/codec2/`. The Sounds panel links to the [Codec2 source](https://github.com/drowe67/codec2).

Digital waits for 40 ms of audio (two 20 ms Codec2 frames) before it emits, so that voice is late by about 45–60 ms. Handheld and Degraded do not add that wait. Clean does not load the worklet.

Compiling that module needs `'wasm-unsafe-eval'` on the page script policy. That keyword does not allow JavaScript `eval`. The preview page does not load the module, and its connect policy stays `'none'`.

## Desktop installer

The desktop app and the web app share this renderer, so a desktop build from this source has the filter. `spike/client/package.json` stays at 0.4.9. The publish job does not replace a release that already exists, so the installed 0.4.9 setup is left as it was. The next version cut is what ships a new installer. The web app updates when this lands on `main`.
