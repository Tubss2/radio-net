import { describe, expect, it } from 'vitest';
import { clampSoundVolume, DEFAULT_SOUND_VOLUME, uiSoundGain } from './sounds';
import { normaliseProfile } from './profile';

describe('UI sound level', () => {
  it('defaults to a quiet level and clamps the slider', () => {
    expect(clampSoundVolume(undefined)).toBe(DEFAULT_SOUND_VOLUME);
    expect(clampSoundVolume(1.4)).toBe(1);
    expect(clampSoundVolume(-0.2)).toBe(0);
    expect(uiSoundGain(true, 0.4)).toBe(0.4);
    expect(uiSoundGain(false, 0.4)).toBe(0);
    expect(uiSoundGain(true, 0)).toBe(0);
  });

  it('keeps a saved level and fills one in for an older profile', () => {
    const older = normaliseProfile({ callsign: 'Toby', servers: [], keybinds: null, overlayOn: true, radios: {} });
    expect(older.soundsOn).toBe(true);
    expect(older.soundVolume).toBe(DEFAULT_SOUND_VOLUME);
    const saved = normaliseProfile({ ...older, soundsOn: false, soundVolume: 0.15 });
    expect(saved.soundsOn).toBe(false);
    expect(saved.soundVolume).toBe(0.15);
    expect(saved.callsign).toBe('Toby');
  });
});
