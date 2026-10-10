import squelchUrl from '../assets/squelch.wav?url';
import { clampSoundVolume, DEFAULT_SOUND_VOLUME, soundPrefsFrom, uiSoundGain, type SoundPrefs } from '../../../shared/sounds';

/**
 * squelch.wav is a short mono edit of "Radio Sign Off / Squelch" by JovianSounds
 * (CC0). Credit is in CREDITS/SOUNDS.md. The file is levelled for the default
 * 40% UI volume.
 */
let prefs: SoundPrefs = soundPrefsFrom({});
let clip: HTMLAudioElement | null = null;
let audio: AudioContext | null = null;

export function setUiSounds(next: SoundPrefs) {
  prefs = { ...next, volume: clampSoundVolume(next.volume) };
}

function level(): number {
  return uiSoundGain(true, prefs.volume);
}

function squelchClip(gain: number) {
  if (gain <= 0 || typeof Audio === 'undefined') return;
  const el = clip ?? (clip = new Audio(squelchUrl));
  el.pause();
  try { el.currentTime = 0; } catch { /* the clip may not be seekable yet */ }
  el.volume = gain;
  void el.play().catch(() => undefined);
}

/** Oscillator confirmation. Gain matches the old 0.06 blip at the default volume. */
function tone(hz: number, gain: number) {
  if (gain <= 0 || typeof AudioContext === 'undefined') return;
  const ctx = audio ?? (audio = new AudioContext());
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  const peak = 0.06 * (gain / DEFAULT_SOUND_VOLUME);
  o.frequency.value = hz;
  g.gain.setValueAtTime(peak, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.07);
  o.connect(g).connect(ctx.destination);
  o.start();
  o.stop(ctx.currentTime + 0.08);
}

/** Quiet squelch when a channel is newly added onto this radio. */
export function playSquelch() {
  if (!prefs.addChannel) return;
  squelchClip(level());
}

/** Press and release cues for this radio's own push-to-talk. Off unless that cue is enabled. */
export function playPttEdge(edge: 'down' | 'up') {
  if (!prefs.ptt) return;
  const gain = level();
  tone(edge === 'down' ? 1200 : 700, gain);
  squelchClip(gain);
}

/** Short tone when the transmit channel changes. */
export function playTxChange() {
  if (!prefs.txChange) return;
  tone(880, level());
}

/** Settings preview. Plays that cue once at the current volume even when its switch is off. */
export function previewSound(cue: 'add' | 'ptt' | 'tx') {
  const gain = level();
  if (cue === 'add') squelchClip(gain);
  else if (cue === 'tx') tone(880, gain);
  else {
    tone(1200, gain);
    squelchClip(gain);
    window.setTimeout(() => {
      tone(700, gain);
      squelchClip(gain);
    }, 180);
  }
}
