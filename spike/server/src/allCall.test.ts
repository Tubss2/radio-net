import { describe, expect, it } from 'vitest';
import { ALL_CALL_ATTR, allCallUnavailable, planAllCall } from './allCall.js';
import type { Channel } from './store.js';

function ch(id: string): Channel {
  return {
    id,
    communityId: 'c1',
    freqKHz: 59500,
    name: id,
    restrictedTag: null,
    createdBy: 'admin',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('all-call plan', () => {
  const channels = [ch('cmd'), ch('arty')];

  it('forwards every tuned channel except the one the admin is already in', () => {
    expect(planAllCall('cmd', ['cmd', 'arty'], channels)).toEqual({
      sourceRoom: 'gc1.chcmd',
      destinations: ['gc1.charty'],
    });
    expect(planAllCall('cmd', ['cmd'], channels)).toEqual({
      sourceRoom: 'gc1.chcmd',
      destinations: [],
    });
    expect(ALL_CALL_ATTR).toBe('rn.allcall');
  });

  it('rejects a channel this community does not have, and a missing source', () => {
    expect(planAllCall('cmd', ['cmd', 'other'], channels)).toBe('unknown');
    expect(planAllCall('logi', ['cmd'], channels)).toBe('source');
    expect(planAllCall('cmd', [], channels)).toBe('empty');
    expect(planAllCall('cmd', Array.from({ length: 17 }, (_, i) => `c${i}`), channels)).toBe('too_many');
  });

  it('treats a missing participant as unavailable without reading the message into a response', () => {
    expect(allCallUnavailable({ status: 404, message: 'participant not found rnk_secret' })).toBe(true);
    expect(allCallUnavailable({ code: 'not_found' })).toBe(true);
    expect(allCallUnavailable(new Error('livekit down'))).toBe(false);
  });
});
