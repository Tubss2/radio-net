import squelchUrl from '../assets/squelch.wav?url';
import { clampSoundVolume, DEFAULT_SOUND_VOLUME, uiSoundGain } from '../../../shared/sounds';

/**
 * squelch.wav is a short mono edit of "Radio Sign Off / Squelch" by JovianSounds
 * (CC0). Credit is in CREDITS/SOUNDS.md. The file is levelled for the default
 * 40% UI volume.
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
