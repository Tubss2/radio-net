import { describe, expect, it } from 'vitest';
import { browserDiskNeedsScrub, profileForDisk, profileWithSessions, sessionsFromProfile } from './browserProfile';
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
  it('keeps the invite on disk and the join session and admin key out of it', () => {
    const disk = profileForDisk(sample());
    expect(disk.servers[0].adminKey).toBeUndefined();
    expect(disk.servers[0].inviteCode).toBe('K7QM-2XPA');
    expect(disk.servers[0].token).toBeUndefined();
    expect(JSON.stringify(disk)).not.toContain('session-token');
    expect(JSON.stringify(disk)).not.toContain('rnk_live');
    expect(sessionsFromProfile(sample())).toEqual({
      wdnz: { token: 'session-token', tokenExp: 1_700_000_000_000 },
    });
  });

  it('writes the admin key only when the user opts in', () => {
    const profile = sample();
    profile.servers[0].rememberAdmin = true;
    const disk = profileForDisk(profile);
    expect(disk.servers[0].adminKey).toBe('rnk_live');
    expect(disk.servers[0].token).toBeUndefined();
    expect(JSON.stringify(disk)).not.toContain('session-token');
  });

  it('restores a session for this tab and drops one that was only on disk', () => {
    const disk = profileForDisk(sample());
    const restored = profileWithSessions(disk, sessionsFromProfile(sample()));
    expect(restored.servers[0].token).toBe('session-token');
    const signedOut = profileWithSessions(sample(), {});
    expect(signedOut.servers[0].token).toBeUndefined();
    expect(signedOut.servers[0].adminKey).toBeUndefined();
    const optedIn = profileWithSessions({ ...sample(), servers: [{ ...sample().servers[0], rememberAdmin: true }] }, {});
    expect(optedIn.servers[0].adminKey).toBe('rnk_live');
  });

  it('flags a legacy blob that still holds a token or an admin key', () => {
    expect(browserDiskNeedsScrub(sample())).toBe(true);
    expect(browserDiskNeedsScrub(profileForDisk(sample()))).toBe(false);
    const opted = sample();
    opted.servers[0].rememberAdmin = true;
    expect(browserDiskNeedsScrub(profileForDisk(opted))).toBe(false);
  });
});
