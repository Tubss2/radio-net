import { describe, expect, it, vi } from 'vitest';
import { canonicalJoin } from '../../../shared/identity';
import { Api } from './api';
import { openDeviceSession, type HeldDevice } from './deviceSession';

const device: HeldDevice = { deviceId: 'ab'.repeat(32), publicKeySpki: 'cHVibGlj' };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function joined(extra: Record<string, unknown> = {}) {
  return json({
    token: 'device-token',
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    callsign: 'Toby',
    role: 'member',
    deviceId: device.deviceId,
    community: { id: 'c1', name: 'Unit' },
    ...extra,
  });
}

describe('desktop device sign-in', () => {
  it('signs a challenge for a device the server already knows', async () => {
    const signed: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith('/challenge')) return json({ challengeId: 'ch', nonce: 'n', expiresAt: new Date().toISOString() });
      if (path.endsWith('/join')) return joined();
      return json({ error: 'unexpected' }, 500);
    }));
    const api = new Api('https://radio.example', null, null);
    api.retryWaits = [0];
    const result = await openDeviceSession(api, {
      callsign: 'Toby',
      device,
      communityId: 'c1',
      sign: async (message) => { signed.push(message); return 'c2ln'; },
    });
    expect(signed).toEqual([canonicalJoin('ch', 'n', 'c1', device.deviceId)]);
    expect(result.deviceId).toBe(device.deviceId);
    expect(result.community.inviteCode).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it('registers after a not-enrolled challenge, and migrates a legacy session without spending the invite first', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      calls.push(`${init?.method ?? 'GET'} ${path}`);
      if (path.endsWith('/challenge')) return json({ error: 'This device is not enrolled.' }, 404);
      if (path.endsWith('/migrate')) {
        expect(init?.headers).toMatchObject({ authorization: 'Bearer legacy-token' });
        return joined();
      }
      return json({ error: 'unexpected' }, 500);
    }));
    const api = new Api('https://radio.example', null, null);
    api.retryWaits = [0];
    const migrated = await openDeviceSession(api, {
      callsign: 'Toby',
      device,
      communityId: 'c1',
      inviteCode: 'ABCD-EFGH',
      legacyToken: 'legacy-token',
      sign: async () => 'c2ln',
    });
    expect(migrated.token).toBe('device-token');
    expect(calls).toEqual(['POST /api/communities/c1/challenge', 'POST /api/join/migrate']);
    vi.unstubAllGlobals();
  });

  it('registers when the server has not seen this device, and falls back when register is missing', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      calls.push(`${init?.method ?? 'GET'} ${path}`);
      if (path.endsWith('/challenge')) return json({ error: 'This device is not enrolled.' }, 404);
      if (path.endsWith('/register')) {
        const body = JSON.parse(String(init?.body)) as { deviceId: string; publicKeySpki: string };
        expect(body.deviceId).toBe(device.deviceId);
        expect(body.publicKeySpki).toBe(device.publicKeySpki);
        return joined();
      }
      return json({ error: 'unexpected' }, 500);
    }));
    const api = new Api('https://radio.example', null, null);
    api.retryWaits = [0];
    const registered = await openDeviceSession(api, {
      callsign: 'Toby',
      device,
      communityId: 'c1',
      inviteCode: 'ABCD-EFGH',
      sign: async () => 'c2ln',
    });
    expect(registered.deviceId).toBe(device.deviceId);
    expect(calls).toEqual(['POST /api/communities/c1/challenge', 'POST /api/join/register']);

    calls.length = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      calls.push(path);
      if (path === '/api/join') return json({ token: 'legacy', expiresAt: new Date(Date.now() + 3600_000).toISOString(), callsign: 'Toby', community: { id: 'c1', name: 'Unit', inviteCode: 'ABCD-EFGH' } });
      return json({ message: `Route ${init?.method ?? 'GET'}:${path} not found`, error: 'Not Found' }, 404);
    }));
    const old = new Api('https://radio.example', null, null);
    old.retryWaits = [0];
    const legacy = await openDeviceSession(old, {
      callsign: 'Toby',
      device,
      communityId: 'c1',
      inviteCode: 'ABCD-EFGH',
      sign: async () => 'c2ln',
    });
    expect(legacy.token).toBe('legacy');
    expect(calls).toContain('/api/join');
    vi.unstubAllGlobals();
  });

  it('signs a challenge when register or migrate says this device is already enrolled', async () => {
    const session = {
      token: 'signed-token',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      callsign: 'Toby',
      role: 'member' as const,
      deviceId: device.deviceId,
      community: { id: 'c9', name: 'Unit' },
    };
    const calls: string[] = [];
    const signed: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      calls.push(`${init?.method ?? 'GET'} ${path}`);
      if (path === '/api/join/register' || path === '/api/join/migrate') {
        return json({ error: 'This device is already enrolled.', code: 'already_enrolled', communityId: 'c9' }, 409);
      }
      if (path === '/api/communities/c9/challenge') return json({ challengeId: 'ch', nonce: 'n', expiresAt: session.expiresAt });
      if (path === '/api/communities/c9/join') {
        const body = JSON.parse(String(init?.body)) as { deviceId: string; signature: string };
        expect(body.deviceId).toBe(device.deviceId);
        expect(body.signature.length).toBeGreaterThan(20);
        return json(session);
      }
      return json({ error: 'unexpected' }, 500);
    }));
    const api = new Api('https://radio.example', null, null);
    api.retryWaits = [0];
    const registered = await openDeviceSession(api, {
      callsign: 'Toby',
      device,
      inviteCode: 'ABCD-EFGH',
      sign: async (message) => { signed.push(message); return 'c2lnbmF0dXJlLWRldmljZS1rZXk='; },
    });
    expect(registered.token).toBe('signed-token');
    expect(signed).toEqual([canonicalJoin('ch', 'n', 'c9', device.deviceId)]);
    expect(calls).toEqual([
      'POST /api/join/register',
      'POST /api/communities/c9/challenge',
      'POST /api/communities/c9/join',
    ]);

    calls.length = 0;
    signed.length = 0;
    const legacyToken = Buffer.from(JSON.stringify({ sid: 'legacy' })).toString('base64url');
    const migrated = await openDeviceSession(api, {
      callsign: 'Toby',
      device,
      legacyToken,
      inviteCode: 'ABCD-EFGH',
      sign: async (message) => { signed.push(message); return 'c2lnbmF0dXJlLWRldmljZS1rZXk='; },
    });
    expect(migrated.token).toBe('signed-token');
    expect(calls[0]).toBe('POST /api/join/migrate');
    expect(calls).toContain('POST /api/communities/c9/join');
    expect(calls).not.toContain('POST /api/join/register');
    expect(signed).toEqual([canonicalJoin('ch', 'n', 'c9', device.deviceId)]);
    vi.unstubAllGlobals();
  });

  it('registers again when a legacy session was already moved to a device', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const path = new URL(String(url)).pathname;
      calls.push(path);
      if (path === '/api/join/migrate') return json({ error: 'This sign-in was already moved to a device.', code: 'migrate_used' }, 409);
      if (path === '/api/join/register') return joined();
      return json({ error: 'unexpected' }, 500);
    }));
    const api = new Api('https://radio.example', null, null);
    api.retryWaits = [0];
    const legacyToken = Buffer.from(JSON.stringify({ sid: 'legacy' })).toString('base64url');
    const result = await openDeviceSession(api, {
      callsign: 'Toby',
      device,
      legacyToken,
      inviteCode: 'ABCD-EFGH',
      sign: async () => 'c2ln',
    });
    expect(result.token).toBe('device-token');
    expect(calls).toEqual(['/api/join/migrate', '/api/join/register']);
    vi.unstubAllGlobals();
  });

  it('uses the invite join when this PC has no device key yet', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      expect(new URL(String(url)).pathname).toBe('/api/join');
      return json({ token: 'legacy', expiresAt: new Date(Date.now() + 3600_000).toISOString(), callsign: 'Toby', community: { id: 'c1', name: 'Unit', inviteCode: 'ABCD-EFGH' } });
    }));
    const api = new Api('https://radio.example', null, null);
    api.retryWaits = [0];
    const legacy = await openDeviceSession(api, { callsign: 'Toby', device: null, inviteCode: 'ABCD-EFGH', sign: async () => 'nope' });
    expect(legacy.token).toBe('legacy');
    vi.unstubAllGlobals();
  });
});
