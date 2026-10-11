import { generateKeyPairSync, sign } from 'node:crypto';
import { TokenVerifier } from 'livekit-server-sdk';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { signSession } from '../src/accounts.js';
import { buildApp } from '../src/app.js';
import { ChallengeTable, canonicalJoin } from '../src/identity.js';
import { FileChannelStore, MemoryChannelStore, identityStoreMac, legacyStoreMac, roomNameFor, storeMac, type StoreSnapshot } from '../src/store.js';
import { freshDevice, registerDevice } from './devices.js';

const cfg = { livekitUrl: 'ws://x', livekitHttpUrl: 'http://127.0.0.1:1', apiKey: 'devkey', apiSecret: 'secret-secret-secret-secret-secret' };

async function world(extra: Partial<Parameters<typeof buildApp>[1]> = {}) {
  const removed: string[] = [];
  const app = buildApp(new MemoryChannelStore(), {
    ...cfg,
    roomAdmin: {
      listRooms: async () => [],
      deleteRoom: async () => {},
      removeParticipant: async (room, identity) => { removed.push(`${room} ${identity}`); },
    },
    ...extra,
  });
  const created = await app.inject({ method: 'POST', url: '/api/communities', payload: { name: 'War Dogs NZ' } });
  const community = created.json().community;
  const adminKey = created.json().adminKey as string;
  const admin = { 'x-admin-key': adminKey };
  return { app, community, adminKey, admin, cid: community.id as string, removed };
}

function signJoin(device: ReturnType<typeof freshDevice>, challengeId: string, nonce: string, cid: string): string {
  const message = canonicalJoin(challengeId, nonce, cid, device.deviceId);
  return sign('sha256', Buffer.from(message), { key: device.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64');
}

describe('device identity', () => {
  it('stops issuing challenges after 30 in a minute for one device', () => {
    const table = new ChallengeTable();
    const deviceId = 'ab'.repeat(32);
    for (let i = 0; i < 30; i++) table.issue('community', deviceId);
    expect(() => table.issue('community', deviceId)).toThrow(/wait a minute/);
    expect(table.issue('community', 'cd'.repeat(32)).challengeId).toBeTruthy();
  });

  it('enrolls once, refuses a second register without a signature, and closes the old join', async () => {
    const { app, community, admin, cid } = await world();
    const device = freshDevice();
    const first = await registerDevice(app, community.inviteCode, 'Rifleman', device);
    expect(first.res.statusCode).toBe(200);
    expect(first.res.json().community.inviteCode).toBeUndefined();
    const second = await registerDevice(app, community.inviteCode, 'Actual', device);
    expect(second.res.statusCode).toBe(409);
    expect(second.res.json()).toEqual({
      error: 'This device is already enrolled.',
      code: 'already_enrolled',
      communityId: cid,
    });
    expect(second.res.json().token).toBeUndefined();
    const still = await app.inject({ url: `/api/communities/${cid}/devices`, headers: admin });
    expect(still.json().devices.map((d: { callsign: string }) => d.callsign)).toEqual(['Rifleman']);
    const invites = await app.inject({ url: `/api/communities/${cid}/invites`, headers: admin });
    expect(invites.json().invites).toEqual([expect.objectContaining({ code: community.inviteCode, uses: 1, maxUses: null })]);
    const closed = await app.inject({ method: 'POST', url: '/api/join', payload: { inviteCode: community.inviteCode, callsign: 'Late' } });
    expect(closed.statusCode).toBe(410);
    expect(closed.json()).toEqual({
      error: 'This server uses device sign-in. Update the app, then join once with your invite.',
      code: 'device_signin',
    });
    const after = await app.inject({ url: `/api/communities/${cid}/invites`, headers: admin });
    expect(after.json().invites[0].uses).toBe(1);
    const health = await app.inject({ url: '/health' });
    expect(health.json()).toEqual({ ok: true, identity: 1 });
    expect((await app.inject({ url: '/api/join/policy' })).json()).toEqual({ powBits: 0 });
  });

  it('signs a challenge, rejects a replay, and keeps a ban after LiveKit fails', async () => {
    const removed: string[] = [];
    const { app, community, admin, cid } = await world({
      roomAdmin: {
        listRooms: async () => [],
        deleteRoom: async () => {},
        removeParticipant: async (room, identity) => {
          removed.push(`${room} ${identity}`);
          throw new Error('livekit down');
        },
      },
    });
    const device = freshDevice();
    const enrolled = await registerDevice(app, community.inviteCode, 'Rifleman', device);
    const token = enrolled.res.json().token as string;
    const channel = await app.inject({
      method: 'POST', url: `/api/communities/${cid}/channels`, headers: admin, payload: { freq: '59.5', name: 'Command' },
    });
    const challenge = await app.inject({
      method: 'POST', url: `/api/communities/${cid}/challenge`, payload: { deviceId: device.deviceId },
    });
    expect(challenge.statusCode).toBe(200);
    const { challengeId, nonce } = challenge.json();
    const signature = signJoin(device, challengeId, nonce, cid);
    const joined = await app.inject({
      method: 'POST', url: `/api/communities/${cid}/join`,
      payload: { challengeId, deviceId: device.deviceId, signature, callsign: 'Actual' },
    });
    expect(joined.statusCode).toBe(200);
    expect(joined.json().callsign).toBe('Actual');
    expect(JSON.parse(Buffer.from(joined.json().token.split('.')[0], 'base64url').toString('utf8')).epoch).toBeUndefined();
    expect((await app.inject({
      method: 'POST', url: `/api/communities/${cid}/join`,
      payload: { challengeId, deviceId: device.deviceId, signature },
    })).statusCode).toBe(401);

    const stranger = freshDevice();
    const unknown = await app.inject({
      method: 'POST', url: `/api/communities/${cid}/challenge`, payload: { deviceId: stranger.deviceId },
    });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error).toBe('This device is not enrolled.');

    const revoked = await app.inject({
      method: 'POST', url: `/api/communities/${cid}/devices/${device.deviceId}/revoke`, headers: admin,
    });
    expect(revoked.statusCode).toBe(200);
    const identity = `d${device.deviceId}`;
    const phoneRoom = `g${cid}.phone.${identity}`;
    expect(removed).toEqual([
      `${roomNameFor({ communityId: cid, id: channel.json().channel.id })} ${identity}`,
      `${phoneRoom} ${identity}`,
      `${phoneRoom} phone:${identity}`,
    ]);
    expect((await app.inject({ url: `/api/communities/${cid}/channels`, headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401);
    const bannedChallenge = await app.inject({
      method: 'POST', url: `/api/communities/${cid}/challenge`, payload: { deviceId: device.deviceId },
    });
    expect(bannedChallenge.statusCode).toBe(404);
    expect(bannedChallenge.json().error).toBe(unknown.json().error);
    const again = await registerDevice(app, community.inviteCode, 'Rifleman', device);
    expect(again.res.statusCode).toBe(403);
    expect(again.res.json().error).toMatch(/removed/);

    const restored = await app.inject({
      method: 'POST', url: `/api/communities/${cid}/devices/${device.deviceId}/restore`, headers: admin,
    });
    expect(restored.json().revokedAt).toBeNull();
    expect((await app.inject({
      method: 'POST', url: `/api/communities/${cid}/challenge`, payload: { deviceId: device.deviceId },
    })).statusCode).toBe(200);
  });

  it('lets an admin device mint a capped invite and hides that code from members', async () => {
    const { app, community, admin, adminKey, cid } = await world();
    const device = freshDevice();
    const enrolled = await registerDevice(app, community.inviteCode, 'Lead', device);
    const member = { authorization: `Bearer ${enrolled.res.json().token}` };
    expect((await app.inject({ url: `/api/communities/${cid}/devices`, headers: member })).statusCode).toBe(403);
    expect((await app.inject({ url: `/api/communities/${cid}/invites`, headers: member })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/communities/${cid}/claim-admin`, headers: member })).statusCode).toBe(403);
    const claimed = await app.inject({
      method: 'POST', url: `/api/communities/${cid}/claim-admin`, headers: { ...member, 'x-admin-key': adminKey },
    });
    expect(claimed.json()).toEqual({ role: 'admin', deviceId: device.deviceId });
    const minted = await app.inject({
      method: 'POST', url: `/api/communities/${cid}/invites`, headers: member,
      payload: { label: 'Friday', maxUses: 1 },
    });
    expect(minted.statusCode).toBe(201);
    expect(minted.json().invite).toMatchObject({ maxUses: 1, uses: 0, label: 'Friday', createdBy: device.deviceId });
    const guest = await registerDevice(app, minted.json().invite.code, 'Guest');
    expect(guest.res.statusCode).toBe(200);
    expect((await registerDevice(app, minted.json().invite.code, 'Second')).res.statusCode).toBe(404);
    const list = await app.inject({ url: `/api/communities/${cid}/devices`, headers: member });
    expect(list.statusCode).toBe(200);
    expect(JSON.stringify(list.json())).not.toContain('publicKeySpki');
    expect(list.json().devices.map((d: { callsign: string; shortId: string }) => d.callsign)).toEqual(['Lead', 'Guest']);
    expect(list.json().devices[0].shortId).toBe(device.deviceId.slice(-8));
    expect((await app.inject({
      method: 'POST', url: `/api/communities/${cid}/devices/${guest.device.deviceId}/role`, headers: member, payload: { role: 'admin' },
    })).json().role).toBe('admin');
    expect((await app.inject({
      method: 'POST', url: `/api/communities/${cid}/devices/${device.deviceId}/role`, headers: admin, payload: { role: 'member' },
    })).json().role).toBe('member');
    expect((await app.inject({
      method: 'POST', url: `/api/communities/${cid}/channels`, headers: member, payload: { freq: '50.0', name: 'Net' },
    })).statusCode).toBe(403);
  });

  it('migrates a legacy session once, counts that seat, and a rotated key does not demote the device', async () => {
    const app = buildApp(new MemoryChannelStore(), { ...cfg, communitySetupCode: 'letmein' });
    const created = await app.inject({ method: 'POST', url: '/api/communities', payload: { name: 'Unit', setupCode: 'letmein' } });
    const { adminKey, community } = created.json();
    const legacy = signSession({
      cid: community.id, name: 'Toby', sid: 'legacy-sid-9', exp: Math.floor(Date.now() / 1000) + 3600,
      scope: 'member', epoch: 0,
    }, cfg.apiSecret);
    const device = freshDevice();
    const migrated = await app.inject({
      method: 'POST', url: '/api/join/migrate',
      headers: { authorization: `Bearer ${legacy}` },
      payload: { deviceId: device.deviceId, publicKeySpki: device.publicKeySpki, callsign: 'Toby' },
    });
    expect(migrated.statusCode).toBe(200);
    expect(migrated.json().deviceId).toBe(device.deviceId);
    const admin = { 'x-admin-key': adminKey };
    const invites = await app.inject({ url: `/api/communities/${community.id}/invites`, headers: admin });
    expect(invites.json().invites[0].uses).toBe(1);
    const other = freshDevice();
    const second = await app.inject({
      method: 'POST', url: '/api/join/migrate',
      headers: { authorization: `Bearer ${legacy}` },
      payload: { deviceId: other.deviceId, publicKeySpki: other.publicKeySpki, callsign: 'Other' },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('migrate_used');
    expect(second.json().token).toBeUndefined();
    expect((await app.inject({ url: `/api/communities/${community.id}/invites`, headers: admin })).json().invites[0].uses).toBe(1);
    const claimed = await app.inject({
      method: 'POST', url: `/api/communities/${community.id}/claim-admin`,
      headers: { authorization: `Bearer ${migrated.json().token}`, 'x-admin-key': adminKey },
    });
    expect(claimed.statusCode).toBe(200);
    const rotated = await app.inject({
      method: 'POST', url: `/api/communities/${community.id}/admin/rotate`, payload: { setupCode: 'letmein' },
    });
    expect((await app.inject({
      method: 'POST', url: `/api/communities/${community.id}/channels`,
      headers: { authorization: `Bearer ${migrated.json().token}` },
      payload: { freq: '51.0', name: 'Still' },
    })).statusCode).toBe(201);
    expect((await app.inject({
      method: 'POST', url: `/api/communities/${community.id}/channels`,
      headers: { 'x-admin-key': adminKey },
      payload: { freq: '52.0', name: 'Old key' },
    })).statusCode).toBe(403);
    expect(rotated.json().adminKey).not.toBe(adminKey);

    const banned = await app.inject({
      method: 'POST', url: `/api/communities/${community.id}/devices/${device.deviceId}/revoke`,
      headers: { 'x-admin-key': rotated.json().adminKey },
    });
    expect(banned.statusCode).toBe(200);
    const again = await app.inject({
      method: 'POST', url: '/api/join/migrate',
      headers: { authorization: `Bearer ${legacy}` },
      payload: { deviceId: device.deviceId, publicKeySpki: device.publicKeySpki },
    });
    expect(again.statusCode).toBe(403);

    const enrolled = freshDevice();
    await registerDevice(app, community.inviteCode, 'Kept', enrolled);
    const repeat = await app.inject({
      method: 'POST', url: '/api/join/migrate',
      headers: { authorization: `Bearer ${legacy}` },
      payload: { deviceId: enrolled.deviceId, publicKeySpki: enrolled.publicKeySpki },
    });
    expect(repeat.statusCode).toBe(409);
    expect(repeat.json().code).toBe('migrate_used');
  });

  it('burns a legacy token when the device is already enrolled and does not mint a session', async () => {
    const { app, community, admin, cid } = await world();
    const device = freshDevice();
    await registerDevice(app, community.inviteCode, 'Rifleman', device);
    const legacy = signSession({
      cid, name: 'Rifleman', sid: 'legacy-sid-2', exp: Math.floor(Date.now() / 1000) + 3600,
      scope: 'member', epoch: 0,
    }, cfg.apiSecret);
    const migrated = await app.inject({
      method: 'POST', url: '/api/join/migrate',
      headers: { authorization: `Bearer ${legacy}` },
      payload: { deviceId: device.deviceId, publicKeySpki: device.publicKeySpki, callsign: 'Renamed' },
    });
    expect(migrated.statusCode).toBe(409);
    expect(migrated.json()).toMatchObject({ code: 'already_enrolled', communityId: cid });
    expect(migrated.json().token).toBeUndefined();
    const other = freshDevice();
    const again = await app.inject({
      method: 'POST', url: '/api/join/migrate',
      headers: { authorization: `Bearer ${legacy}` },
      payload: { deviceId: other.deviceId, publicKeySpki: other.publicKeySpki },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('migrate_used');
    const list = await app.inject({ url: `/api/communities/${cid}/devices`, headers: admin });
    expect(list.json().devices.map((d: { callsign: string }) => d.callsign)).toEqual(['Rifleman']);
  });

  it('refuses a phone redeem after a ban and keeps a voice grant to two minutes', async () => {
    const { app, community, admin, cid, removed } = await world();
    const device = freshDevice();
    const enrolled = await registerDevice(app, community.inviteCode, 'Rifleman', device);
    const member = { authorization: `Bearer ${enrolled.res.json().token}` };
    const channel = await app.inject({
      method: 'POST', url: `/api/communities/${cid}/channels`, headers: admin, payload: { freq: '59.5', name: 'Command' },
    });
    const grants = await app.inject({
      method: 'POST', url: `/api/communities/${cid}/radio/tokens`, headers: member,
      payload: { channelIds: [channel.json().channel.id] },
    });
    const voicePart = String(grants.json().grants[0].token).split('.')[1] ?? '';
    const voice = JSON.parse(Buffer.from(voicePart, 'base64url').toString('utf8')) as { exp: number; nbf: number };
    expect(voice.exp - voice.nbf).toBe(120);
    await new TokenVerifier(cfg.apiKey, cfg.apiSecret).verify(grants.json().grants[0].token);
    const paired = await app.inject({ method: 'POST', url: `/api/communities/${cid}/radio/phone-pair`, headers: member });
    const code = paired.json().code as string;
    const banned = await app.inject({
      method: 'POST', url: `/api/communities/${cid}/devices/${device.deviceId}/revoke`, headers: admin,
    });
    expect(banned.statusCode).toBe(200);
    const identity = `d${device.deviceId}`;
    expect(removed).toContain(`g${cid}.phone.${identity} ${identity}`);
    expect(removed).toContain(`g${cid}.phone.${identity} phone:${identity}`);
    expect((await app.inject({ method: 'POST', url: '/api/phone/redeem', payload: { code } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/api/communities/${cid}/radio/phone-host`, headers: member })).statusCode).toBe(401);
  });

  it('rejects a key that is not P-256 or whose id does not match', async () => {
    const { app, community } = await world();
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const spki = rsa.publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
    const tooBig = await app.inject({
      method: 'POST', url: '/api/join/register',
      payload: {
        inviteCode: community.inviteCode,
        callsign: 'Nope',
        deviceId: 'ab'.repeat(32),
        publicKeySpki: spki.toString('base64'),
      },
    });
    expect(tooBig.statusCode).toBe(400);
    const device = freshDevice();
    const mismatch = await registerDevice(app, community.inviteCode, 'Nope', { ...device, deviceId: 'cd'.repeat(32) });
    expect(mismatch.res.statusCode).toBe(400);
  });

  it('does not log invite codes, signatures, or tokens', async () => {
    const lines: string[] = [];
    const { app, community, admin, cid } = await world({ log: (line) => lines.push(line) });
    const device = freshDevice();
    const enrolled = await registerDevice(app, community.inviteCode, 'Rifleman', device);
    const challenge = await app.inject({
      method: 'POST', url: `/api/communities/${cid}/challenge`, payload: { deviceId: device.deviceId },
    });
    const signature = signJoin(device, challenge.json().challengeId, challenge.json().nonce, cid);
    await app.inject({
      method: 'POST', url: `/api/communities/${cid}/join`,
      payload: { challengeId: challenge.json().challengeId, deviceId: device.deviceId, signature },
    });
    await app.inject({ url: `/api/communities/${cid}/invites`, headers: admin });
    const text = lines.join('\n');
    expect(text).not.toContain(community.inviteCode);
    expect(text).not.toContain(enrolled.res.json().token);
    expect(text).not.toContain(signature);
    expect(text).not.toContain(device.publicKeySpki);
  });

  it('loads a pre-identity store.json and refuses a legacy mac that smuggles a device', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rn-id-'));
    const file = join(dir, 'store.json');
    const snap: StoreSnapshot = {
      communities: [{
        id: 'c1', name: 'Unit', band: { minKHz: 30000, maxKHz: 87500, stepKHz: 500 },
        inviteCode: 'ABCD-EF23', adminKeyHash: 'ab'.repeat(32), createdAt: '2020-01-01T00:00:00.000Z',
      }],
      channels: [],
      devices: [],
      invites: [],
      legacyMigrations: [],
    };
    writeFileSync(file, JSON.stringify({ communities: snap.communities, channels: snap.channels, mac: legacyStoreMac(snap, 'mac-key') }));
    const store = new FileChannelStore(file, 'mac-key');
    expect(store.listInvites('c1')).toEqual([expect.objectContaining({
      code: 'ABCD-EF23', maxUses: null, uses: 0, createdBy: 'admin-key', revokedAt: null,
    })]);
    const raw = JSON.parse(readFileSync(file, 'utf8')) as StoreSnapshot & { mac: string };
    expect(raw.invites).toHaveLength(1);
    expect(raw.mac).toBe(storeMac({
      ...snap,
      invites: raw.invites,
      devices: raw.devices,
      legacyMigrations: raw.legacyMigrations,
    }, 'mac-key'));

    const smuggle = join(dir, 'smuggle.json');
    writeFileSync(smuggle, JSON.stringify({
      communities: snap.communities,
      channels: snap.channels,
      mac: legacyStoreMac(snap, 'mac-key'),
      devices: [{ id: 'aa'.repeat(32), communityId: 'c1', publicKeySpki: 'AQID' }],
    }));
    expect(() => new FileChannelStore(smuggle, 'mac-key')).toThrow(/integrity/);

    const previous = join(dir, 'previous.json');
    const previousSnap = { ...snap, invites: raw.invites, devices: raw.devices };
    const { legacyMigrations: _dropped, ...previousBody } = previousSnap;
    writeFileSync(previous, JSON.stringify({ ...previousBody, mac: identityStoreMac(previousSnap, 'mac-key') }));
    const reloaded = new FileChannelStore(previous, 'mac-key');
    reloaded.burnLegacyMigration('legacy-sid-1', 'c1', null);
    const again = new FileChannelStore(previous, 'mac-key');
    expect(again.legacyMigrationBurned('legacy-sid-1')).toBe(true);
  });
});
