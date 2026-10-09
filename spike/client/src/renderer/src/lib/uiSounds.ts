import squelchUrl from '../assets/squelch.wav?url';
import { clampSoundVolume, DEFAULT_SOUND_VOLUME, uiSoundGain } from '../../../shared/sounds';

/**
 * squelch.wav is an original synthesized clip: a short band-passed noise burst
 * and a click. It is not a third-party recording.
 */
let enabled = true;
let volume = DEFAULT_SOUND_VOLUME;
let clip: HTMLAudioElement | null = null;

export function setUiSounds(on: boolean, level: number) {
  enabled = on;
  volume = clampSoundVolume(level);
}

/** Quiet squelch played when a channel is newly tuned onto this radio. */
export function playSquelch() {
  const gain = uiSoundGain(enabled, volume);
  if (gain <= 0 || typeof Audio === 'undefined') return;
  const el = clip ?? (clip = new Audio(squelchUrl));
  el.pause();
  try { el.currentTime = 0; } catch { /* the clip may not be seekable yet */ }
  el.volume = gain;
  void el.play().catch(() => undefined);
}
