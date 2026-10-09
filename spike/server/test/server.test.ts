import { TokenVerifier } from 'livekit-server-sdk';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { formatFrequency, parseFrequency, validateFrequency } from '../src/freq.js';
import { MemoryChannelStore } from '../src/store.js';

const cfg = { livekitUrl: 'ws://x', livekitHttpUrl: 'http://127.0.0.1:1', apiKey: 'devkey', apiSecret: 'secret-secret-secret-secret-secret' };

async function setup(extra: Partial<typeof cfg & { communitySetupCode: string; joinRateLimit: number }> = {}) {
  const app = buildApp(new MemoryChannelStore(), { ...cfg, ...extra });
  const created = await app.inject({ method: 'POST', url: '/api/communities', payload: { name: 'War Dogs NZ', displayName: 'Toby', setupCode: extra.communitySetupCode } });
  const { token: ownerToken, community } = created.json();
  const joined = await app.inject({ method: 'POST', url: '/api/join', payload: { inviteCode: community.inviteCode.toLowerCase().replace('-', ' '), displayName: 'Rifleman' } });
  const owner = { authorization: `Bearer ${ownerToken}` };
  const member = { authorization: `Bearer ${joined.json().token}` };
  const cid = community.id as string;
  return { app, owner, member, cid, community, memberId: joined.json().account.id as string };
}

describe('frequencies', () => {
  it('parses common inputs', () => {
    expect(parseFrequency('59.5')).toBe(59500);
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

describe('accounts & communities (no Discord)', () => {
  it('create community -> owner gets token + invite; join by code (case/format-insensitive) -> member', async () => {
    const { app, owner, member, community } = await setup();
    expect(community.role).toBe('owner');
    expect(community.inviteCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const me = (await app.inject({ url: '/api/me', headers: member })).json();
    expect(me.account.displayName).toBe('Rifleman');
    expect(me.communities[0]).toMatchObject({ name: 'War Dogs NZ', role: 'member' });
    expect(me.communities[0].inviteCode).toBeUndefined(); // members don't see the invite
    expect((await app.inject({ url: '/api/me', headers: owner })).json().communities[0].inviteCode).toBe(community.inviteCode);
  });

  it('rejects bad invite codes, bad tokens, missing names', async () => {
    const { app } = await setup();
    expect((await app.inject({ method: 'POST', url: '/api/join', payload: { inviteCode: 'AAAA-AAAA', displayName: 'x' } })).statusCode).toBe(404);
    expect((await app.inject({ url: '/api/me', headers: { authorization: 'Bearer rn_nope' } })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/me' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/communities', payload: { name: 'X' } })).statusCode).toBe(400);
  });

  it('setup code gates community creation when configured', async () => {
    const app = buildApp(new MemoryChannelStore(), { ...cfg, communitySetupCode: 'letmein' });
    expect((await app.inject({ method: 'POST', url: '/api/communities', payload: { name: 'X', displayName: 'A' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/communities', payload: { name: 'X', displayName: 'A', setupCode: 'letmein' } })).statusCode).toBe(201);
  });

  it('rate-limits invite guessing', async () => {
    const app = buildApp(new MemoryChannelStore(), { ...cfg, joinRateLimit: 3 });
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await app.inject({ method: 'POST', url: '/api/join', payload: { inviteCode: 'AAAA-AAA' + i, displayName: 'x' } })).statusCode);
    expect(codes).toEqual([404, 404, 404, 429, 429]);
  });

  it('invite rotation: old code stops working; members cannot rotate', async () => {
    const { app, owner, member, cid, community } = await setup();
    expect((await app.inject({ method: 'POST', url: `/api/communities/${cid}/invite/rotate`, headers: member })).statusCode).toBe(403);
    const r = await app.inject({ method: 'POST', url: `/api/communities/${cid}/invite/rotate`, headers: owner });
    expect(r.json().inviteCode).not.toBe(community.inviteCode);
    expect((await app.inject({ method: 'POST', url: '/api/join', payload: { inviteCode: community.inviteCode, displayName: 'late' } })).statusCode).toBe(404);
  });

  it('owner promotes member to admin; admin can then create channels; kicked member loses access', async () => {
    const { app, owner, member, cid, memberId } = await setup();
    const mk = (h: Record<string, string>) => app.inject({ method: 'POST', url: `/api/communities/${cid}/channels`, headers: h, payload: { freq: '45', name: 'Logi' } });
    expect((await mk(member)).statusCode).toBe(403);
    expect((await app.inject({ method: 'PATCH', url: `/api/communities/${cid}/members/${memberId}`, headers: owner, payload: { role: 'admin' } })).statusCode).toBe(200);
    expect((await mk(member)).statusCode).toBe(201);
    expect((await app.inject({ method: 'DELETE', url: `/api/communities/${cid}/members/${memberId}`, headers: owner })).statusCode).toBe(204);
    expect((await app.inject({ url: `/api/communities/${cid}/channels`, headers: member })).statusCode).toBe(404);
  });

  it('one account can belong to several communities', async () => {
    const { app, member } = await setup();
    const other = await app.inject({ method: 'POST', url: '/api/communities', payload: { name: 'Other Unit', displayName: 'Boss' } });
    await app.inject({ method: 'POST', url: '/api/join', headers: member, payload: { inviteCode: other.json().community.inviteCode } });
    expect((await app.inject({ url: '/api/me', headers: member })).json().communities).toHaveLength(2);
  });
});

describe('channel API', () => {
  it('admin creates, member lists, duplicates rejected, member cannot create/delete', async () => {
    const { app, owner, member, cid } = await setup();
    const url = `/api/communities/${cid}/channels`;
    const r1 = await app.inject({ method: 'POST', url, headers: owner, payload: { freq: '59.5', name: 'Command' } });
    expect(r1.statusCode).toBe(201);
    expect(r1.json().channel).toMatchObject({ freq: '59.5', name: 'Command' });
    expect((await app.inject({ method: 'POST', url, headers: owner, payload: { freq: '41.25', name: 'Off grid' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url, headers: owner, payload: { freq: '88.0', name: 'Too high' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url, headers: owner, payload: { freq: 59.5, name: 'Other' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url, headers: owner, payload: { freq: '60', name: 'command' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url, headers: member, payload: { freq: '60', name: 'Arty' } })).statusCode).toBe(403);
    expect((await app.inject({ url, headers: member })).json().channels).toHaveLength(1);
    const id = r1.json().channel.id;
    expect((await app.inject({ method: 'DELETE', url: `${url}/${id}`, headers: member })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `${url}/${id}`, headers: owner })).statusCode).toBe(204);
    expect((await app.inject({ url, headers: member })).json().channels).toHaveLength(0);
  });

  it('resolves by frequency, exact name, or unique prefix', async () => {
    const { app, owner, member, cid } = await setup();
    const url = `/api/communities/${cid}/channels`;
    await app.inject({ method: 'POST', url, headers: owner, payload: { freq: '59.5', name: 'Command' } });
    await app.inject({ method: 'POST', url, headers: owner, payload: { freq: '41.5', name: 'Arty' } });
    const q = async (s: string) => (await app.inject({ url: `${url}/resolve?q=${encodeURIComponent(s)}`, headers: member })).json().matches.map((m: any) => m.name);
    expect(await q('59.5')).toEqual(['Command']);
    expect(await q('41.5 MHz')).toEqual(['Arty']);
    expect(await q('arty')).toEqual(['Arty']);
    expect(await q('Comm')).toEqual(['Command']);
    expect(await q('nope')).toEqual([]);
  });

  it('outsiders cannot see a community', async () => {
    const { app, cid } = await setup();
    const stranger = await app.inject({ method: 'POST', url: '/api/communities', payload: { name: 'Mine', displayName: 'S' } });
    expect((await app.inject({ url: `/api/communities/${cid}/channels`, headers: { authorization: `Bearer ${stranger.json().token}` } })).statusCode).toBe(404);
  });
});

describe('token grants', () => {
  it('one token per tuned channel, subscribe + mic-only publish, scoped to that room', async () => {
    const { app, owner, member, cid, memberId } = await setup();
    const url = `/api/communities/${cid}/channels`;
    const a = (await app.inject({ method: 'POST', url, headers: owner, payload: { freq: '59.5', name: 'Command' } })).json().channel;
    const b = (await app.inject({ method: 'POST', url, headers: owner, payload: { freq: '41.5', name: 'Arty' } })).json().channel;
    const r = await app.inject({ method: 'POST', url: `/api/communities/${cid}/radio/tokens`, headers: member, payload: { channelIds: [a.id, b.id, 'nope'] } });
    const { grants } = r.json();
    expect(grants).toHaveLength(2);
    const verifier = new TokenVerifier(cfg.apiKey, cfg.apiSecret);
    for (const g of grants) {
      const claims = await verifier.verify(g.token);
      expect(claims.sub).toBe(memberId);
      expect(claims.name).toBe('Rifleman');
      expect(claims.video).toMatchObject({ room: g.room, roomJoin: true, canSubscribe: true, canPublish: true, canPublishData: false });
      expect(claims.video?.canPublishSources).toEqual(['microphone']);
    }
    expect(new Set(grants.map((g: any) => g.room)).size).toBe(2);
  });
});
