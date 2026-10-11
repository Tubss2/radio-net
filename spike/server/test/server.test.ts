import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TokenVerifier } from 'livekit-server-sdk';
import { describe, expect, it } from 'vitest';
import { hashAdminKey, adminKeyMatches, signSession } from '../src/accounts.js';
import { buildApp } from '../src/app.js';
import { isAllowedApiOrigin } from '../src/cors.js';
import { PhonePairs, phoneIdentity, phoneRoomName } from '../src/phone.js';
import { formatFrequency, parseFrequency, validateFrequency } from '../src/freq.js';
import { assertProductionConfig } from '../src/production.js';
import { dropCommunityRooms, roomsToClose } from '../src/rooms.js';
import { loadStore } from '../src/boot.js';
import { FileChannelStore, MemoryChannelStore, roomNameFor } from '../src/store.js';
import { freshDevice, registerDevice } from './devices.js';

const cfg = { livekitUrl: 'ws://x', livekitHttpUrl: 'http://127.0.0.1:1', apiKey: 'devkey', apiSecret: 'secret-secret-secret-secret-secret' };

async function setup(extra: Partial<Parameters<typeof buildApp>[1]> = {}) {
  const app = buildApp(new MemoryChannelStore(), {
    ...cfg,
    roomAdmin: { listRooms: async () => [], deleteRoom: async () => {} },
    ...extra,
  });
  const created = await app.inject({ method: 'POST', url: '/api/communities', payload: { name: 'War Dogs NZ', setupCode: extra.communitySetupCode } });
  const body = created.json();
  const community = body.community;
  const adminKey = body.adminKey as string;
  const joined = await registerDevice(app, community.inviteCode.toLowerCase().replace('-', ' '), 'Rifleman');
  const member = { authorization: `Bearer ${joined.res.json().token}` };
  const admin = { 'x-admin-key': adminKey };
  return { app, admin, member, adminKey, cid: community.id as string, community, session: joined.res.json(), device: joined.device };
}

describe('frequencies', () => {
  it('parses common inputs and always shows one decimal', () => {
    expect(parseFrequency('59.5')).toBe(59500);
    expect(parseFrequency('50')).toBe(50000);
    expect(parseFrequency('50.5')).toBe(50500);
    expect(parseFrequency('50.0')).toBe(50000);
    expect(parseFrequency('59.500 MHz')).toBe(59500);
    expect(parseFrequency('50500')).toBe(50500);
    expect(parseFrequency('abc')).toBeNull();
    expect(formatFrequency(50500)).toBe('50.5');
    expect(formatFrequency(50000)).toBe('50.0');
    expect(formatFrequency(59500)).toBe('59.5');
  });
  it('enforces band and 0.5 MHz steps', () => {
    expect(validateFrequency(59500)).toBeNull();
    expect(validateFrequency(50500)).toBeNull();
    expect(validateFrequency(30000)).toBeNull();
    expect(validateFrequency(87500)).toBeNull();
    expect(validateFrequency(20000)).toMatch(/between/);
    expect(validateFrequency(88000)).toMatch(/between/);
    expect(validateFrequency(87975)).toMatch(/between/);
    expect(validateFrequency(59510)).toMatch(/0\.5 MHz steps/);
    expect(validateFrequency(41250)).toMatch(/0\.5 MHz steps/);
  });
});

describe('communities without accounts', () => {
  it('create returns an admin key once; join by code (any case) returns a session and the callsign', async () => {
    const { community, adminKey, session } = await setup();
    expect(adminKey).toMatch(/^rnk_/);
    expect(adminKeyMatches(adminKey, hashAdminKey(adminKey))).toBe(true);
    expect(community.inviteCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(community.adminKeyHash).toBeUndefined();
    expect(session.callsign).toBe('Rifleman');
    expect(session.community.inviteCode).toBeUndefined();
    expect(session.deviceId).toMatch(/^[0-9a-f]{64}$/);
    expect(session.role).toBe('member');
    expect(session.token).toContain('.');
    const claims = JSON.parse(Buffer.from(session.token.split('.')[0], 'base64url').toString('utf8')) as { did?: string; epoch?: number };
    expect(claims.did).toBe(session.deviceId);
    expect(claims.epoch).toBeUndefined();
  });

  it('rejects a bad invite, a bad session, and a missing callsign', async () => {
    const { app, cid } = await setup();
    const device = freshDevice();
    expect((await registerDevice(app, 'AAAA-AAAA', 'x', device)).res.statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/join/register', payload: { inviteCode: 'AAAA-AAAA', deviceId: device.deviceId, publicKeySpki: device.publicKeySpki } })).statusCode).toBe(400);
    const closed = await app.inject({ method: 'POST', url: '/api/join', payload: { inviteCode: 'AAAA-AAAA', callsign: 'x' } });
    expect(closed.statusCode).toBe(410);
    expect(closed.json().code).toBe('device_signin');
    expect((await app.inject({ url: `/api/communities/${cid}/channels`, headers: { authorization: 'Bearer nope' } })).statusCode).toBe(401);
    expect((await app.inject({ url: `/api/communities/${cid}/channels` })).statusCode).toBe(401);
  });

  it('setup code gates community creation when configured', async () => {
    const app = buildApp(new MemoryChannelStore(), { ...cfg, communitySetupCode: 'letmein' });
    expect((await app.inject({ method: 'POST', url: '/api/communities', payload: { name: 'X' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/communities', payload: { name: 'X', setupCode: 'letmein' } })).statusCode).toBe(201);
  });

  it('rate-limits invite guessing', async () => {
    const app = buildApp(new MemoryChannelStore(), { ...cfg, joinRateLimit: 3 });
    const device = freshDevice();
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await registerDevice(app, `AAAA-AAA${i}`, 'x', device)).res.statusCode);
    expect(codes).toEqual([404, 404, 404, 429, 429]);
  });

  it('counts the join limit per forwarded client when the proxy is trusted', async () => {
    const app = buildApp(new MemoryChannelStore(), { ...cfg, trustProxy: true, joinRateLimit: 1 });
    const device = freshDevice();
    const join = (ip: string) => app.inject({
      method: 'POST', url: '/api/join/register', remoteAddress: '127.0.0.1',
      headers: { 'x-forwarded-for': ip },
      payload: { inviteCode: 'NOPE-NOPE', callsign: 'x', deviceId: device.deviceId, publicKeySpki: device.publicKeySpki },
    });
    expect((await join('203.0.113.8')).statusCode).toBe(404);
    expect((await join('203.0.113.8')).statusCode).toBe(429);
    expect((await join('203.0.113.9')).statusCode).toBe(404);
  });

  it('logs method, path, status and latency without the session or admin key', async () => {
    const lines: string[] = [];
    const { app, admin, member, adminKey, cid, session } = await setup({ log: (line) => lines.push(line) });
    await app.inject({ url: `/api/communities/${cid}/channels`, headers: { ...member, ...admin } });
    const text = lines.join('\n');
    expect(text).toMatch(new RegExp(`GET /api/communities/${cid}/channels 200 \\d+ms`));
    expect(text).not.toContain(session.token);
    expect(text).not.toContain(adminKey);
    expect(text).not.toContain('Bearer');
    expect(text).not.toContain('x-admin-key');
  });

  it('admin key rotates the invite; a session alone cannot', async () => {
    const { app, admin, member, cid, community } = await setup();
    expect((await app.inject({ method: 'POST', url: `/api/communities/${cid}/invite/rotate`, headers: member })).statusCode).toBe(403);
    const r = await app.inject({ method: 'POST', url: `/api/communities/${cid}/invite/rotate`, headers: admin });
    expect(r.json().inviteCode).not.toBe(community.inviteCode);
    expect((await registerDevice(app, community.inviteCode, 'late')).res.statusCode).toBe(404);
    expect((await registerDevice(app, r.json().inviteCode, 'late')).res.statusCode).toBe(200);
    expect((await app.inject({ url: `/api/communities/${cid}/channels`, headers: member })).statusCode).toBe(200);
  });

  it('setup code rotates a lost admin key and the old key stops working', async () => {
    const app = buildApp(new MemoryChannelStore(), { ...cfg, communitySetupCode: 'letmein' });
    const created = await app.inject({ method: 'POST', url: '/api/communities', payload: { name: 'Unit', setupCode: 'letmein' } });
    const { adminKey, community } = created.json();
    const url = `/api/communities/${community.id}/channels`;
    expect((await app.inject({ method: 'POST', url, headers: { 'x-admin-key': adminKey }, payload: { freq: '50', name: 'Net' } })).statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: `/api/communities/${community.id}/admin/rotate`, payload: {} })).statusCode).toBe(403);
    const rotated = await app.inject({ method: 'POST', url: `/api/communities/${community.id}/admin/rotate`, payload: { setupCode: 'letmein' } });
    expect(rotated.json().adminKey).toMatch(/^rnk_/);
    expect(rotated.json().adminKey).not.toBe(adminKey);
    expect((await app.inject({ method: 'POST', url, headers: { 'x-admin-key': adminKey }, payload: { freq: '50.5', name: 'Other' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url, headers: { 'x-admin-key': rotated.json().adminKey }, payload: { freq: '50.5', name: 'Other' } })).statusCode).toBe(201);
  });

  it('the same callsign can join two communities, each with its own session', async () => {
    const { app, community } = await setup();
    const other = await app.inject({ method: 'POST', url: '/api/communities', payload: { name: 'Other Unit' } });
    const device = freshDevice();
    const a = await registerDevice(app, community.inviteCode, 'Toby', device);
    const b = await registerDevice(app, other.json().community.inviteCode, 'Toby', device);
    expect(a.res.statusCode).toBe(200);
    expect(b.res.statusCode).toBe(200);
    expect(a.res.json().token).not.toBe(b.res.json().token);
    expect(a.res.json().community.id).not.toBe(b.res.json().community.id);
  });
});

describe('channel API', () => {
  it('admin key creates, a session lists, duplicates rejected, a session cannot create or delete', async () => {
    const { app, admin, member, cid } = await setup();
    const url = `/api/communities/${cid}/channels`;
    const r1 = await app.inject({ method: 'POST', url, headers: admin, payload: { freq: '59.5', name: 'Command' } });
    expect(r1.statusCode).toBe(201);
    expect(r1.json().channel).toMatchObject({ freq: '59.5', name: 'Command' });
    expect((await app.inject({ method: 'POST', url, headers: admin, payload: { freq: '50', name: 'Fifty' } })).json().channel.freq).toBe('50.0');
    expect((await app.inject({ method: 'POST', url, headers: admin, payload: { freq: '41.25', name: 'Off grid' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url, headers: admin, payload: { freq: '88.0', name: 'Too high' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url, headers: admin, payload: { freq: 59.5, name: 'Other' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url, headers: admin, payload: { freq: '60', name: 'command' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url, headers: member, payload: { freq: '60', name: 'Arty' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url, headers: { 'x-admin-key': 'rnk_wrong' }, payload: { freq: '60', name: 'Arty' } })).statusCode).toBe(403);
    expect((await app.inject({ url, headers: member })).json().channels.map((c: { freq: string }) => c.freq)).toEqual(['50.0', '59.5']);
    const id = r1.json().channel.id;
    expect((await app.inject({ method: 'DELETE', url: `${url}/${id}`, headers: member })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `${url}/${id}`, headers: admin })).statusCode).toBe(204);
  });

  it('resolves by frequency, exact name, or unique prefix', async () => {
    const { app, admin, member, cid } = await setup();
    const url = `/api/communities/${cid}/channels`;
    await app.inject({ method: 'POST', url, headers: admin, payload: { freq: '59.5', name: 'Command' } });
    await app.inject({ method: 'POST', url, headers: admin, payload: { freq: '41.5', name: 'Arty' } });
    const q = async (s: string) => (await app.inject({ url: `${url}/resolve?q=${encodeURIComponent(s)}`, headers: member })).json().matches.map((m: { name: string }) => m.name);
    expect(await q('59.5')).toEqual(['Command']);
    expect(await q('50')).toEqual([]);
    expect(await q('41.5 MHz')).toEqual(['Arty']);
    expect(await q('arty')).toEqual(['Arty']);
    expect(await q('Comm')).toEqual(['Command']);
    expect(await q('nope')).toEqual([]);
  });

  it('a session for another community cannot see this one', async () => {
    const { app, cid } = await setup();
    const stranger = await app.inject({ method: 'POST', url: '/api/communities', payload: { name: 'Mine' } });
    const joined = await registerDevice(app, stranger.json().community.inviteCode, 'S');
    expect((await app.inject({ url: `/api/communities/${cid}/channels`, headers: { authorization: `Bearer ${joined.res.json().token}` } })).statusCode).toBe(404);
  });

  it('reloads the data file and still deletes a channel with the admin key', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'rn-')), 'store.json');
    const first = buildApp(new FileChannelStore(file), cfg);
    const created = await first.inject({ method: 'POST', url: '/api/communities', payload: { name: 'Reload' } });
    const { adminKey, community } = created.json();
    const ch = await first.inject({
      method: 'POST',
      url: `/api/communities/${community.id}/channels`,
      headers: { 'x-admin-key': adminKey },
      payload: { freq: '59.5', name: 'Command' },
    });
    expect(ch.statusCode).toBe(201);
    const channelId = ch.json().channel.id as string;
    await first.close();

    const second = buildApp(new FileChannelStore(file), cfg);
    const headers = { 'x-admin-key': adminKey, 'content-type': 'application/json' };
    const removed = await second.inject({
      method: 'DELETE',
      url: `/api/communities/${community.id}/channels/${channelId}`,
      headers,
      payload: '',
    });
    expect(removed.statusCode).toBe(204);
    const malformed = await second.inject({
      method: 'DELETE',
      url: `/api/communities/${community.id}/channels/${channelId}`,
      headers,
      payload: '{',
    });
    expect(malformed.statusCode).toBe(400);
    const joined = await registerDevice(second, community.inviteCode, 'Toby');
    const listed = await second.inject({
      url: `/api/communities/${community.id}/channels`,
      headers: { authorization: `Bearer ${joined.res.json().token}` },
    });
    expect(listed.json().channels).toEqual([]);
    await second.close();

    const third = buildApp(new FileChannelStore(file), cfg);
    const again = await registerDevice(third, community.inviteCode, 'Toby');
    const still = await third.inject({
      url: `/api/communities/${community.id}/channels`,
      headers: { authorization: `Bearer ${again.res.json().token}` },
    });
    expect(still.json().channels).toEqual([]);
    await third.close();
  });

  it('admin key deletes a community, and a reload does not bring it back', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'rn-')), 'store.json');
    const first = buildApp(new FileChannelStore(file), cfg);
    const keep = await first.inject({ method: 'POST', url: '/api/communities', payload: { name: 'Keep' } });
    const drop = await first.inject({ method: 'POST', url: '/api/communities', payload: { name: 'Drop' } });
    const { adminKey, community } = drop.json();
    await first.inject({
      method: 'POST',
      url: `/api/communities/${community.id}/channels`,
      headers: { 'x-admin-key': adminKey },
      payload: { freq: '45.0', name: 'Logi' },
    });
    const session = await registerDevice(first, community.inviteCode, 'Toby');
    expect((await first.inject({ method: 'DELETE', url: `/api/communities/${community.id}`, headers: { authorization: `Bearer ${session.res.json().token}` } })).statusCode).toBe(403);
    expect((await first.inject({ method: 'DELETE', url: `/api/communities/${community.id}`, headers: { 'x-admin-key': adminKey } })).statusCode).toBe(204);
    expect((await registerDevice(first, community.inviteCode, 'Toby')).res.statusCode).toBe(404);
    await first.close();

    const second = buildApp(new FileChannelStore(file), cfg);
    expect((await registerDevice(second, community.inviteCode, 'Toby')).res.statusCode).toBe(404);
    const kept = await registerDevice(second, keep.json().community.inviteCode, 'Toby');
    expect(kept.res.statusCode).toBe(200);
    expect(kept.res.json().community.name).toBe('Keep');
    await second.close();
  });

  it('a file store keeps communities and channels across a new process', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'rn-')), 'store.json');
    const first = buildApp(new FileChannelStore(file), cfg);
    const created = await first.inject({ method: 'POST', url: '/api/communities', payload: { name: 'Saved' } });
    const { adminKey, community } = created.json();
    await first.inject({ method: 'POST', url: `/api/communities/${community.id}/channels`, headers: { 'x-admin-key': adminKey }, payload: { freq: '50.5', name: 'Net' } });
    await first.close();

    const second = buildApp(new FileChannelStore(file), cfg);
    const joined = await registerDevice(second, community.inviteCode, 'Toby');
    const listed = await second.inject({ url: `/api/communities/${community.id}/channels`, headers: { authorization: `Bearer ${joined.res.json().token}` } });
    expect(listed.json().channels).toEqual([expect.objectContaining({ freq: '50.5', name: 'Net' })]);
    const again = await second.inject({ method: 'POST', url: '/api/communities', payload: { name: 'Saved' } });
    expect(again.json().community.id).not.toBe(community.id);
    await second.close();
  });
});

describe('deploy config', () => {
  it('renders Caddy without HTTP/3, with a rotated JSON access log, and trusts the proxy', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rn-setup-'));
    execFileSync('bash', ['deploy/setup.sh'], {
      cwd: join(import.meta.dirname, '../../..'),
      env: { ...process.env, PUBLIC_IP: '203.0.113.10', RENDER_ONLY: dir },
      encoding: 'utf8',
    });
    const caddy = readFileSync(join(dir, 'Caddyfile'), 'utf8');
    expect(caddy).toMatch(/protocols h1 h2/);
    expect(caddy).not.toMatch(/\bh3\b/);
    expect(caddy).toContain('wrap json');
    expect(caddy).toContain('request>headers delete');
    expect(caddy).toContain('/var/log/caddy/access.log');
    expect(caddy).toContain('roll_size 10mb');
    const env = readFileSync(join(dir, 'api.env'), 'utf8');
    expect(env).toMatch(/^TRUST_PROXY=1$/m);
    const secrets = readFileSync(join(dir, 'secrets.env'), 'utf8');
    expect(secrets).toMatch(/^RN_STORE_MAC_KEY=[A-Za-z0-9]+$/m);
    const setup = readFileSync(join(import.meta.dirname, '../../../deploy/setup.sh'), 'utf8');
    expect(setup).toContain('PasswordAuthentication no');
    expect(setup).toContain('fail2ban');
    expect(setup).toContain('unattended-upgrades');
    const unit = readFileSync(join(import.meta.dirname, '../../../deploy/systemd/radionet-caddy.service'), 'utf8');
    expect(unit).toContain('/var/log/caddy');
    expect(unit).toContain('LogsDirectory=caddy');
  });
});

describe('browser CORS', () => {
  it('allows the Pages origin and local dev, and keeps credentials off', async () => {
    expect(isAllowedApiOrigin(undefined)).toBe(true);
    expect(isAllowedApiOrigin('null')).toBe(true);
    expect(isAllowedApiOrigin('https://tubss2.github.io')).toBe(true);
    expect(isAllowedApiOrigin('http://127.0.0.1:5175')).toBe(true);
    expect(isAllowedApiOrigin('http://localhost:5175')).toBe(true);
    expect(isAllowedApiOrigin('https://evil.example')).toBe(false);
    expect(isAllowedApiOrigin('https://tubss2.github.io.evil.com')).toBe(false);
    expect(isAllowedApiOrigin('https://localhost:5175')).toBe(true);

    const { app } = await setup();
    const preflight = (origin: string) => app.inject({
      method: 'OPTIONS',
      url: '/api/join',
      headers: {
        origin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type,x-admin-key',
      },
    });
    const pages = await preflight('https://tubss2.github.io');
    expect(pages.headers['access-control-allow-origin']).toBe('https://tubss2.github.io');
    expect(pages.headers['access-control-allow-credentials']).not.toBe('true');
    const local = await preflight('http://127.0.0.1:5175');
    expect(local.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5175');
    const evil = await preflight('https://evil.example');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('phone push-to-talk pairing', () => {
  it('forgets an expired code and will not redeem it twice', () => {
    let now = 1_000_000;
    const pairs = new PhonePairs(() => now);
    const issued = pairs.issue({ cid: 'dev', sid: 'sid-1', name: 'Toby', epoch: 0 }, 1000);
    expect(Buffer.from(issued.code, 'base64url')).toHaveLength(32);
    expect(pairs.take(issued.code)).toMatchObject({ sid: 'sid-1' });
    expect(pairs.take(issued.code)).toBeNull();
    const again = pairs.issue({ cid: 'dev', sid: 'sid-1', name: 'Toby', epoch: 0 }, 1000);
    now += 1001;
    expect(pairs.take(again.code)).toBeNull();
    expect(phoneRoomName('dev', 'sid-1')).toBe('gdev.phone.sid-1');
    expect(phoneIdentity('sid-1')).toBe('phone:sid-1');
  });

  it('gives the phone a data-only token for that visit and no API session', async () => {
    const { app, member, cid, session } = await setup();
    const claims = JSON.parse(Buffer.from(session.token.split('.')[0], 'base64url').toString('utf8')) as { sid: string; did: string };
    const live = `d${claims.did}`;
    expect(live).not.toBe(claims.sid);
    expect((await app.inject({ method: 'POST', url: `/api/communities/${cid}/radio/phone-pair` })).statusCode).toBe(401);
    const host = await app.inject({ method: 'POST', url: `/api/communities/${cid}/radio/phone-host`, headers: member });
    expect(host.statusCode).toBe(200);
    expect(host.json().phoneIdentity).toBe(`phone:${live}`);
    expect(host.json().room).toBe(phoneRoomName(cid, live));
    const paired = await app.inject({ method: 'POST', url: `/api/communities/${cid}/radio/phone-pair`, headers: member });
    const code = paired.json().code as string;
    const redeemed = await app.inject({ method: 'POST', url: '/api/phone/redeem', payload: { code } });
    expect(redeemed.statusCode).toBe(200);
    expect(redeemed.json().token).not.toBe(session.token);
    expect(redeemed.json().identity).toBe(`phone:${live}`);
    expect(redeemed.json().communityName).toBe('War Dogs NZ');
    expect((await app.inject({ method: 'POST', url: '/api/phone/redeem', payload: { code } })).statusCode).toBe(404);
    const verifier = new TokenVerifier(cfg.apiKey, cfg.apiSecret);
    const phoneClaims = await verifier.verify(redeemed.json().token);
    const hostClaims = await verifier.verify(host.json().token);
    for (const tokenClaims of [phoneClaims, hostClaims]) {
      expect(tokenClaims.video).toMatchObject({
        room: host.json().room, roomJoin: true, canSubscribe: true, canPublish: false, canPublishData: true,
      });
      expect(tokenClaims.video?.canPublishSources ?? []).toEqual([]);
    }
    expect(phoneClaims.sub).toBe(`phone:${live}`);
    expect(hostClaims.sub).toBe(live);
  });
});


describe('hardening', () => {
  it('sends security headers and does not reflect an arbitrary web origin', async () => {
    const app = buildApp(new MemoryChannelStore(), cfg);
    const res = await app.inject({ method: 'GET', url: '/health', headers: { origin: 'https://evil.example' } });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['access-control-allow-origin']).not.toBe('https://evil.example');
    const local = await app.inject({ method: 'GET', url: '/health', headers: { origin: 'http://127.0.0.1:5173' } });
    expect(local.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5173');
    const pages = await app.inject({ method: 'GET', url: '/health', headers: { origin: 'https://tubss2.github.io' } });
    expect(pages.headers['access-control-allow-origin']).toBe('https://tubss2.github.io');
    const lookalike = await app.inject({ method: 'GET', url: '/health', headers: { origin: 'https://tubss2.github.io.evil.example' } });
    expect(lookalike.headers['access-control-allow-origin']).not.toBe('https://tubss2.github.io.evil.example');
    const fileOrigin = await app.inject({ method: 'GET', url: '/health', headers: { origin: 'null' } });
    expect(fileOrigin.headers['access-control-allow-origin']).toBe('null');
  });

  it('rejects an oversized body', async () => {
    const app = buildApp(new MemoryChannelStore(), cfg);
    const res = await app.inject({ method: 'POST', url: '/api/join', headers: { 'content-type': 'application/json' }, payload: `{"inviteCode":"${'A'.repeat(70_000)}"}` });
    expect(res.statusCode).toBe(413);
  });

  it('forgets the oldest IP once the tracker is full', async () => {
    const app = buildApp(new MemoryChannelStore(), { ...cfg, joinRateLimit: 1, maxTrackedIps: 2 });
    const device = freshDevice();
    const join = (ip: string) => app.inject({
      method: 'POST', url: '/api/join/register', remoteAddress: ip,
      payload: { inviteCode: 'NOPE-NOPE', callsign: 'x', deviceId: device.deviceId, publicKeySpki: device.publicKeySpki },
    });
    expect((await join('203.0.113.1')).statusCode).toBe(404);
    expect((await join('203.0.113.2')).statusCode).toBe(404);
    expect((await join('203.0.113.3')).statusCode).toBe(404);
    expect((await join('203.0.113.2')).statusCode).toBe(429);
    expect((await join('203.0.113.1')).statusCode).toBe(404);
  });

  it('keeps enrolled devices when the invite rotates and drops legacy tokens', async () => {
    const { app, admin, member, cid, community } = await setup();
    const legacy = signSession({
      cid, name: 'Old', sid: 'legacy-sid-1', exp: Math.floor(Date.now() / 1000) + 3600,
      scope: 'member', epoch: 0,
    }, cfg.apiSecret);
    const rotated = await app.inject({ method: 'POST', url: `/api/communities/${cid}/invite/rotate`, headers: admin });
    expect((await app.inject({ url: `/api/communities/${cid}/channels`, headers: member })).statusCode).toBe(200);
    expect((await app.inject({ url: `/api/communities/${cid}/channels`, headers: { authorization: `Bearer ${legacy}` } })).statusCode).toBe(401);
    const joined = await registerDevice(app, rotated.json().inviteCode, 'late');
    expect((await app.inject({ url: `/api/communities/${cid}/channels`, headers: { authorization: `Bearer ${joined.res.json().token}` } })).statusCode).toBe(200);
    expect(rotated.json().inviteCode).not.toBe(community.inviteCode);
  });

  it('closes this community\'s voice and phone rooms before the invite changes', async () => {
    const deleted: string[] = [];
    const seen = { cid: '' };
    const { app, admin, member, cid, community } = await setup({
      roomAdmin: {
        listRooms: async () => [
          { name: `g${seen.cid}.phone.visit` },
          { name: 'gother.phone.leave' },
        ],
        deleteRoom: async (name: string) => { deleted.push(name); },
      },
    });
    seen.cid = cid;
    const created = await app.inject({
      method: 'POST', url: `/api/communities/${cid}/channels`, headers: admin,
      payload: { freq: '59.5', name: 'Command' },
    });
    const channelId = created.json().channel.id as string;
    const paired = await app.inject({ method: 'POST', url: `/api/communities/${cid}/radio/phone-pair`, headers: member });
    const code = paired.json().code as string;
    const rotated = await app.inject({ method: 'POST', url: `/api/communities/${cid}/invite/rotate`, headers: admin });
    expect(rotated.statusCode).toBe(200);
    expect(deleted).toContain(roomNameFor({ communityId: cid, id: channelId }));
    expect(deleted).toContain(`g${cid}.phone.visit`);
    expect(deleted).not.toContain('gother.phone.leave');
    expect((await app.inject({ method: 'POST', url: '/api/phone/redeem', payload: { code } })).statusCode).toBe(404);
    expect((await registerDevice(app, community.inviteCode, 'late')).res.statusCode).toBe(404);
  });

  it('does not rotate the invite when voice rooms cannot be closed', async () => {
    const { app, admin, cid, community } = await setup({
      roomAdmin: {
        listRooms: async () => { throw new Error('livekit down'); },
        deleteRoom: async () => {},
      },
    });
    const rotated = await app.inject({ method: 'POST', url: `/api/communities/${cid}/invite/rotate`, headers: admin });
    expect(rotated.statusCode).toBe(503);
    expect(rotated.json().error).toBe('Could not remove people from voice. Try again.');
    expect((await registerDevice(app, community.inviteCode, 'still')).res.statusCode).toBe(200);
  });

  it('treats an already-empty room as closed', () => {
    expect(roomsToClose('dev', [{ name: 'gdev.phone.a' }, { name: 'gdev2.phone.b' }, { name: 'gother.ch1' }], ['gdev.ch1']))
      .toEqual(['gdev.ch1', 'gdev.phone.a']);
    return expect(dropCommunityRooms({
      listRooms: async () => [],
      deleteRoom: async () => { throw Object.assign(new Error('missing'), { status: 404, code: 'not_found' }); },
    }, 'dev', ['gdev.ch1'])).resolves.toBeUndefined();
  });

  it('rejects a store file with no mac when a key is set', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'rn-mac-')), 'store.json');
    const store = new FileChannelStore(file, 'mac-key');
    store.upsertCommunity({
      id: 'c1', name: 'Unit', band: { minKHz: 30000, maxKHz: 87500, stepKHz: 500 },
      inviteCode: 'ABCD-EF23', adminKeyHash: 'ab'.repeat(32), createdAt: new Date().toISOString(),
    });
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { mac?: string };
    delete raw.mac;
    writeFileSync(file, JSON.stringify(raw));
    expect(() => new FileChannelStore(file, 'mac-key')).toThrow(/integrity/);
  });

  it('does not write the dev community when production refuses to boot', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'rn-boot-')), 'store.json');
    expect(() => loadStore({
      NODE_ENV: 'production',
      SEED_DEV: '1',
      RN_DATA_FILE: file,
      LIVEKIT_API_KEY: 'k',
      LIVEKIT_API_SECRET: 'x'.repeat(20),
      COMMUNITY_SETUP_CODE: 'ok',
    })).toThrow(/SEED_DEV/);
    expect(existsSync(file)).toBe(false);
  });

  it('rejects a tampered store and keeps the file private', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'rn-mac-')), 'store.json');
    const store = new FileChannelStore(file, 'mac-key');
    store.upsertCommunity({
      id: 'c1', name: 'Unit', band: { minKHz: 30000, maxKHz: 87500, stepKHz: 500 },
      inviteCode: 'ABCD-EF23', adminKeyHash: 'ab'.repeat(32), createdAt: new Date().toISOString(),
    });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { mac: string; communities: { name: string }[] };
    expect(raw.mac).toMatch(/^[a-f0-9]{64}$/);
    raw.communities[0].name = 'hacked';
    writeFileSync(file, JSON.stringify(raw));
    expect(() => new FileChannelStore(file, 'mac-key')).toThrow(/integrity/);
  });

  it('refuses the dev seed and the dev secret in production', () => {
    expect(() => assertProductionConfig({ nodeEnv: 'production', seedDev: true, apiKey: 'k', apiSecret: 'x'.repeat(20), setupCode: 'a' })).toThrow(/SEED_DEV/);
    expect(() => assertProductionConfig({ nodeEnv: 'production', seedDev: false, apiKey: 'devkey', apiSecret: 'secret', setupCode: 'a' })).toThrow(/dev LiveKit/);
    expect(() => assertProductionConfig({ nodeEnv: 'production', seedDev: false, apiKey: 'k', apiSecret: 'x'.repeat(20) })).toThrow(/COMMUNITY_SETUP_CODE/);
    expect(() => assertProductionConfig({ nodeEnv: 'development', seedDev: true, apiKey: 'devkey', apiSecret: 'secret' })).not.toThrow();
  });
});


describe('token grants', () => {
  it('one token per tuned channel, subscribe + mic-only publish, named with the callsign', async () => {
    const { app, admin, member, cid } = await setup();
    const url = `/api/communities/${cid}/channels`;
    const a = (await app.inject({ method: 'POST', url, headers: admin, payload: { freq: '59.5', name: 'Command' } })).json().channel;
    const b = (await app.inject({ method: 'POST', url, headers: admin, payload: { freq: '41.5', name: 'Arty' } })).json().channel;
    const r = await app.inject({ method: 'POST', url: `/api/communities/${cid}/radio/tokens`, headers: member, payload: { channelIds: [a.id, b.id, 'nope'] } });
    const { grants } = r.json();
    expect(grants).toHaveLength(2);
    const verifier = new TokenVerifier(cfg.apiKey, cfg.apiSecret);
    const subs = new Set<string>();
    for (const g of grants) {
      const claims = await verifier.verify(g.token);
      expect(claims.sub).toBeTruthy();
      subs.add(String(claims.sub));
      expect(claims.name).toBe('Rifleman');
      expect(claims.video).toMatchObject({
        room: g.room, roomJoin: true, canSubscribe: true, canPublish: true, canPublishData: false,
        roomAdmin: false, roomCreate: false, roomRecord: false,
      });
      expect(claims.video?.canPublishSources).toEqual(['microphone']);
    }
    expect(subs.size).toBe(1);
    expect(new Set(grants.map((g: { room: string }) => g.room)).size).toBe(2);
  });
});
