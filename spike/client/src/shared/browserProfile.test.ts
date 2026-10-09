import { describe, expect, it } from 'vitest';
import { profileForDisk, profileWithSessions, sessionsFromProfile } from './browserProfile';
import { emptyProfile, type Profile } from './profile';

function sample(): Profile {
  return {
    ...emptyProfile(),
    callsign: 'Toby',
    servers: [{
      id: 'wdnz',
      name: 'War Dogs NZ',
      url: 'https://radio.example',
      inviteCode: 'K7QM-2XPA',
      adminKey: 'rnk_live',
      lastUsed: '2026-10-09T00:00:00.000Z',
      token: 'session-token',
      tokenExp: 1_700_000_000_000,
    }],
  };
}

describe('browser profile', () => {
  it('keeps the admin key on disk and the join session out of it', () => {
    const disk = profileForDisk(sample());
    expect(disk.servers[0].adminKey).toBe('rnk_live');
    expect(disk.servers[0].inviteCode).toBe('K7QM-2XPA');
    expect(disk.servers[0].token).toBeUndefined();
    expect(JSON.stringify(disk)).not.toContain('session-token');
    expect(sessionsFromProfile(sample())).toEqual({
      wdnz: { token: 'session-token', tokenExp: 1_700_000_000_000 },
    });
  });

  it('restores a session for this tab and drops one that was only on disk', () => {
    const disk = profileForDisk(sample());
    const restored = profileWithSessions(disk, sessionsFromProfile(sample()));
    expect(restored.servers[0].token).toBe('session-token');
    const signedOut = profileWithSessions(sample(), {});
    expect(signedOut.servers[0].token).toBeUndefined();
    expect(signedOut.servers[0].adminKey).toBe('rnk_live');
  });
});
