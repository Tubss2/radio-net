/** Master level for short UI cues. 0 is silent, 1 is full. Default stays quiet. */
export const DEFAULT_SOUND_VOLUME = 0.4;

export function clampSoundVolume(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : DEFAULT_SOUND_VOLUME;
  return Math.min(1, Math.max(0, Math.round(n * 100) / 100));
}

/** Gain applied to a UI cue. Off, or a volume of 0, plays nothing. */
export function uiSoundGain(on: boolean, volume: number): number {
  if (!on) return 0;
  return clampSoundVolume(volume);
}
