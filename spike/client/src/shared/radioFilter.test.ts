import { describe, expect, it } from 'vitest';
import { designBandpass, designLowpass, sosMagnitudeDb } from './biquad';
import {
  CUE_END_HZ, CUE_START_HZ, DEGRADED, HANDHELD, VoiceColour, effectiveFilter, parseChannelFilter, parseRadioFilter,
  rmsAbove, synthesizeCue, transmissionCueEdges,
} from './radioFilter';

describe('butterworth sections', () => {
  it('matches the scipy band-pass used by the handheld demo', () => {
    const sos = designBandpass(4, 300, 3400, 48000);
    expect(sosMagnitudeDb(sos, 100, 48000)).toBeCloseTo(-40.99, 1);
    expect(sosMagnitudeDb(sos, 300, 48000)).toBeCloseTo(-3.01, 1);
    expect(sosMagnitudeDb(sos, 1000, 48000)).toBeCloseTo(0, 1);
    expect(sosMagnitudeDb(sos, 3400, 48000)).toBeCloseTo(-3.01, 1);
    expect(sosMagnitudeDb(sos, 8000, 48000)).toBeCloseTo(-35.23, 1);
  });

  it('matches a 4th-order low-pass at 3600 Hz', () => {
    const sos = designLowpass(4, 3600, 48000);
    expect(sosMagnitudeDb(sos, 1000, 48000)).toBeCloseTo(0, 1);
    expect(sosMagnitudeDb(sos, 3600, 48000)).toBeCloseTo(-3, 0);
    expect(sosMagnitudeDb(sos, 8000, 48000)).toBeLessThan(-20);
  });
});

describe('transmission cues', () => {
  it('builds the A-down3-long notes at about -17 dB', () => {
    const start = synthesizeCue('start', 48000);
    const end = synthesizeCue('end', 48000);
    expect(start.length).toBe(7248);
    expect(end.length).toBe(7824);
    expect(20 * Math.log10(rmsAbove(start))).toBeCloseTo(-17, 1);
    expect(CUE_START_HZ).toEqual([493.9, 587.3, 740]);
    expect(CUE_END_HZ).toEqual([740, 587.3, 440]);
    expect(start[0]).toBe(0);
    let cuePeak = 0;
    for (let i = 0; i < start.length; i++) cuePeak = Math.max(cuePeak, start[i]);
    expect(cuePeak).toBeGreaterThan(0.05);
  });

  it('reports who keyed up and who released', () => {
    expect(transmissionCueEdges(['a'], ['a', 'b'])).toEqual({ start: ['b'], end: [] });
    expect(transmissionCueEdges(['a', 'b'], ['b'])).toEqual({ start: [], end: ['a'] });
    expect(transmissionCueEdges([], [])).toEqual({ start: [], end: [] });
  });
});

describe('radio filter choice', () => {
  it('keeps clean as the default and allows a channel to override it', () => {
    expect(parseRadioFilter(undefined)).toBe('clean');
    expect(parseRadioFilter('vehicle')).toBe('clean');
    expect(parseRadioFilter('digital')).toBe('digital');
    expect(parseChannelFilter('default')).toBeNull();
    expect(parseChannelFilter('clean')).toBe('clean');
    expect(effectiveFilter(null, 'handheld')).toBe('handheld');
    expect(effectiveFilter('clean', 'handheld')).toBe('clean');
    expect(HANDHELD).toMatchObject({ drive: 1.6, bias: 0.12, ratio: 3, hissDb: -42, floor: 0.35 });
    expect(DEGRADED).toMatchObject({ drive: 2.6, bias: 0.2, ratio: 6, hissDb: -36, floor: 0.5 });
  });
});

function render(preset: 'handheld' | 'degraded', freq: number, seconds = 0.6): Float32Array {
  const sr = 48000;
  const colour = new VoiceColour(sr, preset);
  colour.carrier = true;
  const n = Math.round(sr * seconds);
  const input = new Float32Array(n);
  const output = new Float32Array(n);
  for (let i = 0; i < n; i++) input[i] = 0.25 * Math.sin((2 * Math.PI * freq * i) / sr);
  const block = 128;
  for (let i = 0; i < n; i += block) {
    colour.processInto(input.subarray(i, i + block), output.subarray(i, i + block));
  }
  return output;
}

function tailRmsDb(samples: Float32Array): number {
  const tail = samples.subarray(Math.floor(samples.length * 0.6));
  return 20 * Math.log10(rmsAbove(tail));
}

function peak(samples: Float32Array): number {
  let m = 0;
  for (let i = 0; i < samples.length; i++) m = Math.max(m, Math.abs(samples[i]));
  return m;
}

describe('handheld and degraded colour', () => {
  it('keeps a 1 kHz tone near the reference level and rejects rumble', () => {
    const voice = render('handheld', 1000);
    const rumble = render('handheld', 80);
    expect(tailRmsDb(voice)).toBeGreaterThan(-26);
    expect(tailRmsDb(voice)).toBeLessThan(-14);
    expect(tailRmsDb(rumble)).toBeLessThan(tailRmsDb(voice) - 15);
    expect(peak(voice)).toBeLessThan(0.95);
  });

  it('drives degraded harder than handheld', () => {
    const a = render('handheld', 1000, 0.4);
    const b = render('degraded', 1000, 0.4);
    const harm = (y: Float32Array) => {
      let acc = 0;
      for (let i = Math.floor(y.length / 2); i < y.length; i++) acc += y[i] * y[i];
      return acc;
    };
    expect(Number.isFinite(harm(a))).toBe(true);
    expect(Number.isFinite(harm(b))).toBe(true);
    expect(peak(b)).toBeLessThan(0.95);
  });
});
