import { describe, expect, it } from 'vitest';
import { ADMIN_KEY, loadBrowserProfile, PROFILE_KEY, saveBrowserProfile, SESSION_KEY, type BrowserStorage } from './browserStore';
import { emptyProfile, type Profile } from './profile';

function memory(): BrowserStorage & { dump(): Record<string, string> } {
  const box = new Map<string, string>();
  return {
    getItem: (key) => box.get(key) ?? null,
    setItem: (key, value) => { box.set(key, value); },
    removeItem: (key) => { box.delete(key); },
    dump: () => Object.fromEntries(box),
  };
}

function sample(): Profile {
  return {
    ...emptyProfile(),
    callsign: 'Toby',
    servers: [{
      id: 'wdnz',
      name: 'War Dogs NZ',
      url: 'https://radio.example',
      inviteCode: 'K7QM-2XPA',
      adminKey: 'rnk_secret',
      lastUsed: '2026-10-09T00:00:00.000Z',
      token: 'session-token',
      tokenExp: 1_700_000_000,
    }],
  };
}

describe('browser profile storage', () => {
  it('keeps the session token out of localStorage', () => {
    const local = memory();
    const session = memory();
    saveBrowserProfile(sample(), local, session);
    const durable = local.dump()[PROFILE_KEY];
    expect(durable).toContain('K7QM-2XPA');
    expect(durable).not.toContain('session-token');
    expect(durable).not.toContain('rnk_secret');
    expect(session.dump()[SESSION_KEY]).toContain('session-token');
    expect(local.dump()[ADMIN_KEY]).toBeUndefined();
    const loaded = loadBrowserProfile(local, session);
    expect(loaded.servers[0].token).toBe('session-token');
    expect(loaded.servers[0].adminKey).toBeUndefined();
    expect(loaded.servers[0].inviteCode).toBe('K7QM-2XPA');
  });

  it('writes the admin key only when the user opts in', () => {
    const local = memory();
    const session = memory();
    const profile = sample();
    profile.servers[0].rememberAdmin = true;
    saveBrowserProfile(profile, local, session);
    expect(local.dump()[ADMIN_KEY]).toContain('rnk_secret');
    expect(local.dump()[PROFILE_KEY]).not.toContain('rnk_secret');
    expect(loadBrowserProfile(local, session).servers[0].adminKey).toBe('rnk_secret');

    profile.servers[0].rememberAdmin = false;
    delete profile.servers[0].adminKey;
    saveBrowserProfile(profile, local, session);
    expect(local.dump()[ADMIN_KEY]).toBeUndefined();
    expect(loadBrowserProfile(local, session).servers[0].adminKey).toBeUndefined();
  });

  it('migrates a legacy blob that stored the token and the admin key together', () => {
    const local = memory();
    const session = memory();
    local.setItem(PROFILE_KEY, JSON.stringify(sample()));
    const first = loadBrowserProfile(local, session);
    expect(first.servers[0].token).toBe('session-token');
    expect(first.servers[0].adminKey).toBe('rnk_secret');
    expect(local.dump()[PROFILE_KEY]).not.toContain('session-token');
    expect(local.dump()[PROFILE_KEY]).not.toContain('rnk_secret');
    expect(local.dump()[ADMIN_KEY]).toBeUndefined();
    expect(session.dump()[SESSION_KEY]).toContain('session-token');
    const second = loadBrowserProfile(local, session);
    expect(second.servers[0].token).toBe('session-token');
    expect(second.servers[0].adminKey).toBeUndefined();
  });
});
