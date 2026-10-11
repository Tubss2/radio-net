# Radio filter parameters

These are the numbers in `spike/client/src/shared/radioFilter.ts`. They follow [`DECISIONS.md`](DECISIONS.md).

The Python files in [`reference/`](reference/) produced the approved demos. The app does not run them. Paths inside those scripts point at the research machine, not at this repository. The approved listen is `ref/00-final-picks.mp3` in the spec bundle. That audio is not committed.

## Cues

Both cues use the start cue’s gain, `10^(-17/20) / rms(start)`, the same way `make_v4.py` levels `A-down3-long`.

| | Start | End |
|---|---|---|
| Notes | 493.9, 587.3, 740.0 Hz | 740.0, 587.3, 440.0 Hz |
| Lengths | 44, 44, 63 ms | 44, 44, 75 ms |
| Fade in | 8 ms, sin² | 8 ms, sin² |
| Fade out | 12 ms, cos² | 12 ms, cos² |
| Timbre | 1 + 0.30 × 3rd + 0.12 × 5th | same |

At 48 kHz the start cue is 7248 samples (151 ms) and the end cue is 7824 samples (163 ms). Start RMS is about −16.99 dB before the Sounds volume slider. The slider’s default is 40%, so the cue is quieter than the demo unless the slider is at full.

The 120 ms gap in the demo, between the start cue and the voice, is how the demo was edited. The live cue does not insert that gap.

## Handheld and Degraded

Same chain. Degraded changes the five numbers in the last columns.

1. Band-pass 300–3400 Hz, 4th-order Butterworth.
2. Peak-normalise toward 0.8, then warm clip `(tanh(d·(x+b)) − tanh(d·b)) / d`.
3. Clean-up band-pass 280–3600 Hz, 2nd order.
4. Hiss: noise band-passed 300–3400 Hz, levelled to the voice RMS, scaled by a speech envelope (20 ms attack, 120 ms release), with a floor between words. It fades in and out over 15 ms while that person is marked as talking.
5. AGC on voice plus hiss: threshold 24 dB under the peak, attack 5 ms, release 180 ms.
6. Level toward about −20 dB RMS, with a tanh ceiling at 0.89.

| | Handheld | Degraded |
|---|---|---|
| Drive `d` | 1.6 | 2.6 |
| Bias `b` | 0.12 | 0.20 |
| AGC ratio | 3:1 | 6:1 |
| Hiss under voice RMS | −42 dB | −36 dB |
| Hiss floor between words | 35% | 50% |

No bitcrush. No 400–2800 Hz band. No Vehicle preset.

## Digital

Codec2 mode 2400. 8 kHz, 160 samples and 6 bytes per frame. The worklet gathers 40 ms (320 samples at 8 kHz, two frames).

1. Low-pass at 3600 Hz, 4th order, then a linear resample to 8 kHz.
2. Codec2 encode and decode.
3. Linear resample back to the audio rate.
4. Band-pass 300–3400 Hz, 4th order.
5. Hard gate: −38 dB relative to the running peak, 40 ms hold, 3 ms ramps.
6. Compressor: threshold −24 dB from that peak, 4:1, follower 3 ms attack and 80 ms release.
7. Light peak clip at ×1.4, then undo the ×1.4 scale.
8. Level toward about −21 dB RMS.

No hiss. Added latency is about 45–60 ms (`DIGITAL_LATENCY_MS` is 55). Until the WASM module has loaded, Digital plays the voice dry.

## How the live filter differs from the demos

The approved files were mixed offline. A live stream cannot see the whole clip, and it must not send the cue inside the voice.

- Peak, RMS, and the speech envelope are leaky followers. The demos measure the whole clip.
- The hiss is generated in the worklet. Its level, band, envelope, and floor match. Its exact noise sequence does not.
- The AGC is the same gain-reduction formula as the Python script, applied per sample. It is not `DynamicsCompressorNode`.
- The Digital gate is causal. The research script used a centred smoothing window.
- Resampling is linear after the low-pass. The research script used ffmpeg.
- The start cue does not insert the demo’s 120 ms of silence before the voice.
- Cue level is −17 dB before the Sounds volume slider.
- Other people’s end cue waits until LiveKit reports that they stopped, which is after the sender’s release delay and mute. “Hear your own” is local only.
- One start cue if anyone new is talking, and one end cue if anyone dropped, rather than one cue per person.

The Butterworth sections are second-order sections matched to `scipy.signal.butter`, checked against that magnitude curve. That is why the chain is an AudioWorklet rather than a stack of `BiquadFilterNode`s.
