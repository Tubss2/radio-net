import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { clampSoundVolume, DEFAULT_SOUND_VOLUME, uiSoundGain } from './sounds';
import { normaliseProfile } from './profile';

const repoRoot = join(import.meta.dirname, '../../../..');

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

describe('squelch asset', () => {
  it('is a short mono 16-bit edit of the CC0 recording', () => {
    const wav = readWav(join(repoRoot, 'spike/client/src/renderer/src/assets/squelch.wav'));
    expect(wav.channels).toBe(1);
    expect(wav.bits).toBe(16);
    expect(wav.rate).toBe(44100);
    expect(wav.duration).toBeGreaterThan(0.18);
    expect(wav.duration).toBeLessThan(0.35);
    const peakDb = 20 * Math.log10(wav.peak / 32768);
    expect(peakDb).toBeGreaterThan(-14);
    expect(peakDb).toBeLessThan(-6);
    const credits = readFileSync(join(repoRoot, 'CREDITS/SOUNDS.md'), 'utf8');
    expect(credits).toContain('JovianSounds');
    expect(credits).toContain('524205');
    expect(credits).toContain('CC0');
  });
});

function readWav(path: string) {
  const buf = readFileSync(path);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a wav');
  }
  let offset = 12;
  let channels = 0;
  let rate = 0;
  let bits = 0;
  let data: Buffer | null = null;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(body + 2);
      rate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
    } else if (id === 'data') {
      data = buf.subarray(body, body + size);
    }
    offset = body + size + (size % 2);
  }
  if (!data || !channels || !rate || !bits) throw new Error('incomplete wav');
  let peak = 0;
  for (let i = 0; i + 1 < data.length; i += 2) {
    peak = Math.max(peak, Math.abs(data.readInt16LE(i)));
  }
  return { channels, rate, bits, peak, duration: data.length / (rate * channels * (bits / 8)) };
}
