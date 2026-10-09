import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TokenVerifier } from 'livekit-server-sdk';
import { describe, expect, it } from 'vitest';
import { hashAdminKey, adminKeyMatches } from '../src/accounts.js';
import { buildApp } from '../src/app.js';
import { formatFrequency, parseFrequency, validateFrequency } from '../src/freq.js';
import { FileChannelStore, MemoryChannelStore } from '../src/store.js';

const cfg = { livekitUrl: 'ws://x', livekitHttpUrl: 'http://127.0.0.1:1', apiKey: 'devkey', apiSecret: 'secret-secret-secret-secret-secret' };

async function setup(extra: Partial<Parameters<typeof buildApp>[1]> = {}) {
  const app = buildApp(new MemoryChannelStore(), { ...cfg, ...extra });
  const created = await app.inject({ method: 'POST', url: '/api/communities', payload: { name: 'War Dogs NZ', setupCode: extra.communitySetupCode } });
  const body = created.json();
  const community = body.community;
  const adminKey = body.adminKey as string;
  const joined = await app.inject({ method: 'POST', url: '/api/join', payload: { inviteCode: community.inviteCode.toLowerCase().replace('-', ' '), callsign: 'Rifleman' } });
  const member = { authorization: `Bearer ${joined.json().token}` };
  const admin = { 'x-admin-key': adminKey };
  return { app, admin, member, adminKey, cid: community.id as string, community, session: joined.json() };
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
    expect(session.community.inviteCode).toBe(community.inviteCode);
    expect(session.token).toContain('.');
  });

  it('rejects a bad invite, a bad session, and a missing callsign', async () => {
    const { app, cid } = await setup();
    expect((await app.inject({ method: 'POST', url: '/api/join', payload: { inviteCode: 'AAAA-AAAA', callsign: 'x' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/join', payload: { inviteCode: 'AAAA-AAAA' } })).statusCode).toBe(400);
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
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await app.inject({ method: 'POST', url: '/api/join', payload: { inviteCode: 'AAAA-AAA' + i, callsign: 'x' } })).statusCode);
    expect(codes).toEqual([404, 404, 404, 429, 429]);
  });

  it('counts the join limit per forwarded client when the proxy is trusted', async () => {
    const app = buildApp(new MemoryChannelStore(), { ...cfg, trustProxy: true, joinRateLimit: 1 });
    const join = (ip: string) => app.inject({
      method: 'POST', url: '/api/join', remoteAddress: '127.0.0.1',
      headers: { 'x-forwarded-for': ip },
      payload: { inviteCode: 'NOPE-NOPE', callsign: 'x' },
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
    expect((await app.inject({ method: 'POST', url: '/api/join', payload: { inviteCode: community.inviteCode, callsign: 'late' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/join', payload: { inviteCode: r.json().inviteCode, callsign: 'late' } })).statusCode).toBe(200);
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
    const a = await app.inject({ method: 'POST', url: '/api/join', payload: { inviteCode: community.inviteCode, callsign: 'Toby' } });
    const b = await app.inject({ method: 'POST', url: '/api/join', payload: { inviteCode: other.json().community.inviteCode, callsign: 'Toby' } });
    expect(a.json().token).not.toBe(b.json().token);
    expect(a.json().community.id).not.toBe(b.json().community.id);
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
    const joined = await app.inject({ method: 'POST', url: '/api/join', payload: { inviteCode: stranger.json().community.inviteCode, callsign: 'S' } });
    expect((await app.inject({ url: `/api/communities/${cid}/channels`, headers: { authorization: `Bearer ${joined.json().token}` } })).statusCode).toBe(404);
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
    const joined = await second.inject({ method: 'POST', url: '/api/join', payload: { inviteCode: community.inviteCode, callsign: 'Toby' } });
    const listed = await second.inject({
      url: `/api/communities/${community.id}/channels`,
      headers: { authorization: `Bearer ${joined.json().token}` },
    });
    expect(listed.json().channels).toEqual([]);
    await second.close();

    const third = buildApp(new FileChannelStore(file), cfg);
    const again = await third.inject({ method: 'POST', url: '/api/join', payload: { inviteCode: community.inviteCode, callsign: 'Toby' } });
    const still = await third.inject({
      url: `/api/communities/${community.id}/channels`,
      headers: { authorization: `Bearer ${again.json().token}` },
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
    const session = await first.inject({ method: 'POST', url: '/api/join', payload: { inviteCode: community.inviteCode, callsign: 'Toby' } });
    expect((await first.inject({ method: 'DELETE', url: `/api/communities/${community.id}`, headers: { authorization: `Bearer ${session.json().token}` } })).statusCode).toBe(403);
    expect((await first.inject({ method: 'DELETE', url: `/api/communities/${community.id}`, headers: { 'x-admin-key': adminKey } })).statusCode).toBe(204);
    expect((await first.inject({ method: 'POST', url: '/api/join', payload: { inviteCode: community.inviteCode, callsign: 'Toby' } })).statusCode).toBe(404);
    await first.close();

    const second = buildApp(new FileChannelStore(file), cfg);
    expect((await second.inject({ method: 'POST', url: '/api/join', payload: { inviteCode: community.inviteCode, callsign: 'Toby' } })).statusCode).toBe(404);
    const kept = await second.inject({ method: 'POST', url: '/api/join', payload: { inviteCode: keep.json().community.inviteCode, callsign: 'Toby' } });
    expect(kept.statusCode).toBe(200);
    expect(kept.json().community.name).toBe('Keep');
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
    const joined = await second.inject({ method: 'POST', url: '/api/join', payload: { inviteCode: community.inviteCode, callsign: 'Toby' } });
    const listed = await second.inject({ url: `/api/communities/${community.id}/channels`, headers: { authorization: `Bearer ${joined.json().token}` } });
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
      expect(claims.video).toMatchObject({ room: g.room, roomJoin: true, canSubscribe: true, canPublish: true, canPublishData: false });
      expect(claims.video?.canPublishSources).toEqual(['microphone']);
    }
    expect(subs.size).toBe(1);
    expect(new Set(grants.map((g: { room: string }) => g.room)).size).toBe(2);
  });
});
