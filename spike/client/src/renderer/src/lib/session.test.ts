import { describe, expect, it, vi } from 'vitest';
import { Api } from './api';
import { createExtractable } from './deviceKey';
import { openSession } from './session';
import { bytesToBase64 } from '../../../shared/identity';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('device sign-in', () => {
  it('registers when the server has not seen this device, and falls back when register is missing', async () => {
    const pending = await createExtractable();
    const privateKey = await crypto.subtle.importKey('pkcs8', pending.pkcs8, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    const device = { deviceId: pending.deviceId, publicKeySpki: pending.publicKeySpki, privateKey };
    pending.pkcs8.fill(0);
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      calls.push(`${init?.method ?? 'GET'} ${path}`);
      if (path.endsWith('/challenge')) return json({ error: 'This device is not enrolled.' }, 404);
      if (path.endsWith('/register')) {
        const body = JSON.parse(String(init?.body)) as { deviceId: string; publicKeySpki: string };
        expect(body.deviceId).toBe(device.deviceId);
        expect(body.publicKeySpki).toBe(device.publicKeySpki);
        return json({
          token: 'device-token',
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          callsign: 'Toby',
          role: 'member',
          deviceId: device.deviceId,
          community: { id: 'c1', name: 'Unit' },
        });
      }
      return json({ error: 'unexpected' }, 500);
    }));
    const api = new Api('https://radio.example', null, null);
    api.retryWaits = [0];
    const joined = await openSession(api, { callsign: 'Toby', device, communityId: 'c1', inviteCode: 'ABCD-EFGH' });
    expect(joined.deviceId).toBe(device.deviceId);
    expect(joined.community.inviteCode).toBeUndefined();
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
    const legacy = await openSession(old, { callsign: 'Toby', device, communityId: 'c1', inviteCode: 'ABCD-EFGH' });
    expect(legacy.token).toBe('legacy');
    expect(calls).toContain('/api/join');
    expect(bytesToBase64(new Uint8Array([1, 2]))).toBe('AQI=');
    vi.unstubAllGlobals();
  });

  it('signs a challenge when register or migrate says this device is already enrolled', async () => {
    const pending = await createExtractable();
    const privateKey = await crypto.subtle.importKey('pkcs8', pending.pkcs8, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    const device = { deviceId: pending.deviceId, publicKeySpki: pending.publicKeySpki, privateKey };
    pending.pkcs8.fill(0);
    const session = {
      token: 'signed-token',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      callsign: 'Toby',
      role: 'member' as const,
      deviceId: device.deviceId,
      community: { id: 'c9', name: 'Unit' },
    };
    const calls: string[] = [];
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
    const registered = await openSession(api, { callsign: 'Toby', device, inviteCode: 'ABCD-EFGH' });
    expect(registered.token).toBe('signed-token');
    expect(calls).toEqual([
      'POST /api/join/register',
      'POST /api/communities/c9/challenge',
      'POST /api/communities/c9/join',
    ]);

    calls.length = 0;
    const legacyToken = Buffer.from(JSON.stringify({ sid: 'legacy' })).toString('base64url');
    const migrated = await openSession(api, { callsign: 'Toby', device, legacyToken, inviteCode: 'ABCD-EFGH' });
    expect(migrated.token).toBe('signed-token');
    expect(calls[0]).toBe('POST /api/join/migrate');
    expect(calls).toContain('POST /api/communities/c9/join');
    expect(calls).not.toContain('POST /api/join/register');
    vi.unstubAllGlobals();
  });
});
