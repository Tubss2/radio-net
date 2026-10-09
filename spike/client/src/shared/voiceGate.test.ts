import { describe, expect, it } from 'vitest';
import { stepVoiceGate, voiceThreshold } from './voiceGate';

describe('voice gate', () => {
  it('opens above the threshold and holds through the release delay', () => {
    expect(voiceThreshold(0)).toBeCloseTo(0.2);
    expect(voiceThreshold(1)).toBeCloseTo(0.02);
    const loud = stepVoiceGate({ open: false, rms: 0.1, sensitivity: 0.6, releaseMs: 300, belowSince: null, now: 0 });
    expect(loud.open).toBe(true);
    const holding = stepVoiceGate({ open: true, rms: 0.001, sensitivity: 0.6, releaseMs: 300, belowSince: null, now: 1000 });
    expect(holding.open).toBe(true);
    expect(holding.belowSince).toBe(1000);
    const still = stepVoiceGate({ open: true, rms: 0.001, sensitivity: 0.6, releaseMs: 300, belowSince: 1000, now: 1200 });
    expect(still.open).toBe(true);
    const dropped = stepVoiceGate({ open: true, rms: 0.001, sensitivity: 0.6, releaseMs: 300, belowSince: 1000, now: 1300 });
    expect(dropped.open).toBe(false);
  });
});
