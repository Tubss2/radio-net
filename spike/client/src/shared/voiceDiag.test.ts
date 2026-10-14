import { describe, expect, it } from 'vitest';
import { browserLabel, percentile, sampleFromStats, VoiceSession, type StatRecord } from './voiceDiag';

const audio = (extra: Partial<StatRecord>): StatRecord => ({ type: 'inbound-rtp', kind: 'audio', ...extra });

describe('sampleFromStats', () => {
  it('reads rtt, jitter, and loss from audio stats', () => {
    const sample = sampleFromStats([
      { type: 'candidate-pair', state: 'succeeded', nominated: true, currentRoundTripTime: 0.042 },
      audio({ jitter: 0.008, packetsLost: 2, packetsReceived: 98 }),
      { type: 'remote-inbound-rtp', kind: 'audio', roundTripTime: 0.05, jitter: 0.004 },
    ]);
    expect(sample.rttMs).toBe(50);
    expect(sample.jitterMs).toBe(8);
    expect(sample.lossPct).toBeCloseTo(2, 5);
  });

  it('ignores a candidate pair that is not nominated', () => {
    const sample = sampleFromStats([
      { type: 'candidate-pair', state: 'succeeded', nominated: false, currentRoundTripTime: 0.2 },
      { type: 'candidate-pair', state: 'succeeded', nominated: true, currentRoundTripTime: 0.03 },
    ]);
    expect(sample.rttMs).toBe(30);
  });
});

describe('VoiceSession', () => {
  it('summarises samples, reconnects, and push-to-talk without a callsign', () => {
    const session = new VoiceSession();
    session.noteSample('59.5', { rttMs: 40, jitterMs: 5, lossPct: 0 });
    session.noteSample('59.5', { rttMs: 80, jitterMs: 12, lossPct: 1 });
    session.noteSample('51.0', { rttMs: 30, jitterMs: 4, lossPct: 0 });
    session.noteReconnect('59.5');
    session.notePtt(true);
    session.notePtt(false);
    session.noteSample('not-a-freq', { rttMs: 1, jitterMs: null, lossPct: null });
    const report = session.report({
      clientId: '11111111-1111-4111-8111-111111111111',
      appVersion: '0.4.9',
      surface: 'web',
      browser: 'Chrome 131',
      platform: 'Win32',
      mobile: false,
      tuned: 2,
    });
    expect(report.v).toBe(1);
    expect(report.reconnects).toBe(1);
    expect(report.pttPresses).toBe(1);
    expect(report.pttFailures).toBe(1);
    expect(report.rttMs.p50).toBe(30);
    expect(report.rooms.map((room) => room.freq)).toEqual(['00.0', '51.0', '59.5']);
    expect(report.rooms.find((room) => room.freq === '59.5')?.reconnects).toBe(1);
    expect(JSON.stringify(report)).not.toMatch(/callsign|rnk_|Bearer/i);
  });

  it('drops empty samples', () => {
    const session = new VoiceSession();
    session.noteSample('50.0', { rttMs: null, jitterMs: null, lossPct: null });
    const report = session.report({
      clientId: '11111111-1111-4111-8111-111111111111',
      appVersion: '0.4.9',
      surface: 'web',
      browser: 'unknown',
      platform: '',
      mobile: false,
      tuned: 1,
    });
    expect(report.rooms).toEqual([]);
  });
});

describe('browserLabel', () => {
  it('names the browser family and major version', () => {
    expect(browserLabel('Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36')).toBe('Chrome 131');
    expect(browserLabel('Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0')).toBe('Edge 131');
    expect(browserLabel('Mozilla/5.0 Firefox/128.0')).toBe('Firefox 128');
    expect(percentile([1, 2, 3, 4], 95)).toBe(4);
  });
});
