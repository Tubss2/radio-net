# Radio filter + cue decisions (Tobias, 2026-10-11, after v2-male demos)

Source of truth for the shipped listener filter. The cue question under “Open implementation question” was answered as (a): start and end cues play on each listener’s machine, unfiltered. Parameters the client uses are in [`PARAMETERS.md`](PARAMETERS.md). [`../SCOPE-radio-filter.md`](../SCOPE-radio-filter.md) describes the product.

## Presets
Final list: **Clean**, **Handheld**, **Degraded**, **Digital** (renamed from "Modern"). The v1/v2 Modern attempts were rejected; the Digital candidate is `modern-research/v2/01-codec2-2400.mp3` (Codec 2 at 2400 bit/s), see the modern-research work for its chain. Vehicle is dropped.

| Preset | Source demo | Chain |
|---|---|---|
| Clean | 01-clean | Bypass. |
| Handheld | v2 `02-handheld-v2a` | Band-pass 300–3400 Hz (4th-order Butterworth) → warm asymmetric soft clip `(tanh(d·(x+b)) − tanh(d·b))/d`, drive d=1.6, bias b=0.12 → clean-up band-pass 280–3600 Hz (2nd order) → hiss bed (noise band-passed 300–3400 Hz) at −42 dB under voice RMS, scaled by speech envelope (20 ms attack / 120 ms release), 35% floor between words, only while transmitting (15 ms fades) → AGC on voice+hiss: threshold peak −24 dB, ratio 3:1, attack 5 ms, release 180 ms → level-match. |
| Degraded | v2 `02-handheld-v2b` (the heavier handheld) | Same chain as Handheld with: drive 2.6, bias 0.20, AGC ratio 6:1, hiss −36 dB under voice RMS, 50% hiss floor between words. No bitcrush, no narrow 400–2800 band. |

Rejected: v1/v2 "modern" (now Digital) vocoder imitations; v1/v2 "degraded" chain (400–2800 Hz, drive 6, bitcrush) — too far gone; any static louder than about −36 dB.

Web Audio notes: band-pass = BiquadFilter pairs; soft clip = WaveShaperNode with the curve above; AGC = DynamicsCompressorNode (approximate); hiss = looping noise buffer → band-pass → GainNode driven by an envelope follower (small AudioWorklet or AnalyserNode polling). All listener-side, per user.

## Cues
- **Roger beep removed.** The END cue replaces it. There is no separate rising 1046→1568 Hz roger beep any more.
- Start cue = beep set **A** shape (three quick rising notes); end cue = set A end (three falling notes ending low).
- Soft-square timbre (fundamental + 0.30 × 3rd + 0.12 × 5th harmonic), 8 ms sin² attack, 12 ms cos² release, no gaps, about −17 dB RMS.
- **Chosen pitch: A-down3** (v3 Number 3), set A lowered 3 semitones. Start 494 / 587 / 740 Hz (rising), end 740 / 587 / 440 Hz (falling, ends low).
- Note length: v3 notes (35/35/50 ms start, 35/35/60 ms end) felt too short and sharp, possibly causing ear pain. v4 (`v4/00-v4-beeps.mp3`) tests x1.25 notes with the v3 edges, x1.25 with soft edges, and x1.4 with soft edges. Picked: v4 Number 1 `A-down3-long` (see "Beep cues" below).
- Full example timing: start cue → 120 ms → voice → 150 ms release delay → end cue (release delay was 200 ms).
- Squelch stays only for "add a channel".

## Open implementation question
The old roger beep was mixed into the sender's published audio, so each listener's preset coloured it. In the v3 demo the end cue plays clean, on the listener's device, like the start cue. Pick one: (a) listener-side local cue, unfiltered, triggered on the speaker-drop edge (consistent with the start cue, works for every sender version); or (b) mixed into the sender's track like the old roger beep.

## Digital preset (formerly "Modern", 11 Oct 2026)
Chosen: Codec2 2400 bps with round-one strong post-processing (`modern-research/v2/01-codec2-2400.mp3`, script `tools/make_modern_v2.py`). Tobias may revisit; 1600-light and 1300-light are the alternates.

## Beep cues (11 Oct 2026, final)
Chosen: v4 Number 1 `A-down3-long` (start 494/587/740 Hz at 44/44/63 ms, end 740/587/440 Hz at 44/44/75 ms, 8 ms fade-in and 12 ms fade-out per note). End cue replaces the roger beep and plays locally, unfiltered. Release delay 150 ms.

## Demo of current picks
`final/00-final-picks.mp3`: beeps (A-down3-long), then Handheld, Degraded and Digital, each as a full transmission (start cue, 120 ms, voice, 150 ms, end cue, no roger beep). Male voice.
