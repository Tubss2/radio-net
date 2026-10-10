/** Master level for short UI cues. 0 is silent, 1 is full. Default stays quiet. */
export const DEFAULT_SOUND_VOLUME = 0.4;

/** Which local cues are allowed. Volume is separate and applies to all of them. */
export interface SoundPrefs {
  /** Static when this radio adds a channel to its tuned list. On for a new profile. */
  addChannel: boolean;
  /** Click and static on this radio's own push-to-talk press and release. Off until chosen. */
  ptt: boolean;
  /** Short tone when the transmit channel changes. On for a new profile. */
  txChange: boolean;
  volume: number;
}

/**
 * Squelch marks a person adding an existing channel to their own radio.
 * Creating a channel for the community does not play it, even when the
 * creator's radio then tunes that new channel in the same step.
 */
export function playsAddSquelch(action: 'add' | 'create'): boolean {
  return action === 'add';
}

export function soundPrefsFrom(raw: {
  soundsOn?: boolean;
  soundPtt?: boolean;
  soundTx?: boolean;
  soundVolume?: unknown;
}): SoundPrefs {
  return {
    addChannel: raw.soundsOn !== false,
    ptt: raw.soundPtt === true,
    txChange: raw.soundTx !== false,
    volume: clampSoundVolume(raw.soundVolume),
  };
}

export function clampSoundVolume(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : DEFAULT_SOUND_VOLUME;
  return Math.min(1, Math.max(0, Math.round(n * 100) / 100));
}

/** Gain applied to a UI cue. Off, or a volume of 0, plays nothing. */
export function uiSoundGain(on: boolean, volume: number): number {
  if (!on) return 0;
  return clampSoundVolume(volume);
}
