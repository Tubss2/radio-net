import cors from '@fastify/cors';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { RoomServiceClient } from 'livekit-server-sdk';
import { z } from 'zod';
import {
  adminKeyMatches, cleanLabel, hashAdminKey, liveKitIdentity, newAdminKey, newInviteCode, normaliseInvite,
  secretEquals, signSession, verifySession, type Session,
} from './accounts.js';
import { isAllowedApiOrigin } from './cors.js';
import { DEFAULT_BAND, formatFrequency } from './freq.js';
import {
  DEVICE_SESSION_TTL_SECONDS, ChallengeTable, IdentityError, POW_BITS, canonicalJoin, decodeSignature, parseDeviceKey, verifyJoinSignature,
} from './identity.js';
import { type Channel, ChannelError, type ChannelStore, type Community, type Device, type Invite, roomNameFor } from './store.js';
import { mintPhoneToken, phoneIdentity, phoneRoomName, PhonePairs } from './phone.js';
import { dropCommunityRooms, type RoomAdmin } from './rooms.js';
import { type RadioUser, mintChannelGrants } from './tokens.js';
import { type AllCallControl, allCallUnavailable, liveKitAllCall, planAllCall } from './allCall.js';

export interface AppConfig {
  livekitUrl: string; // ws(s)://... handed to clients
  livekitHttpUrl: string; // http(s)://... for RoomService admin calls
  apiKey: string;
  apiSecret: string;
  /** If set, creating a community (or rotating its admin key) needs this code. Unset = open (dev). */
  communitySetupCode?: string;
  /** Join/create attempts allowed per IP per minute. */
  joinRateLimit?: number;
  /** Other API calls allowed per IP per minute. Health checks are exempt. */
  globalRateLimit?: number;
  /** Cap on distinct IPs remembered by the rate limiters. */
  maxTrackedIps?: number;
  /** Trust X-Forwarded-For from a local reverse proxy (Caddy) so rate limits see real client IPs. */
  trustProxy?: boolean;
  /** One line per request: method, path, status, latency. Must not include tokens. */
  log?: (line: string) => void;
  /** LiveKit room admin. Tests pass a fake. Production uses the Room Service client. */
  roomAdmin?: RoomAdmin;
  /**
   * Forwards an admin's mic into every other tuned channel room.
   * Tests pass a fake. Production uses Room Service, which is the only holder of the LiveKit secret.
   */
  allCall?: AllCallControl;
}

const publicChannel = (c: Channel) => ({
  id: c.id, freqKHz: c.freqKHz, freq: formatFrequency(c.freqKHz), name: c.name, restricted: c.restrictedTag !== null,
});

/** Create still returns the invite once. Ordinary member sessions do not. Admins read codes from the invite list. */
const publicCommunity = (c: Community, includeInvite = false) => ({
  id: c.id,
  name: c.name,
  band: c.band,
  ...(includeInvite ? { inviteCode: c.inviteCode } : {}),
});

const publicInvite = (invite: Invite) => ({
  id: invite.id,
  code: invite.code,
  label: invite.label,
  createdAt: invite.createdAt,
  createdBy: invite.createdBy,
  maxUses: invite.maxUses,
  uses: invite.uses,
  expiresAt: invite.expiresAt,
  revokedAt: invite.revokedAt,
});

const LEGACY_JOIN_MESSAGE = 'This server uses device sign-in. Update the app, then join once with your invite.';
const NOT_ENROLLED = 'This device is not enrolled.';

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public communityId?: string,
  ) { super(message); }
}

export function buildApp(store: ChannelStore, cfg: AppConfig): FastifyInstance {
  const app = Fastify({ logger: false, trustProxy: cfg.trustProxy ?? false, bodyLimit: 64 * 1024 });
  // Fastify rejects an empty `application/json` body with 400. DELETE often carries that header and no body.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser(/^application\/json(?:;.*)?$/, { parseAs: 'string' }, (_req, body, done) => {
    const text = typeof body === 'string' ? body : (body as Buffer).toString('utf8');
    if (text.trim() === '') {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(text));
    } catch (err) {
      const error = err as Error & { statusCode?: number };
      error.statusCode = 400;
      done(error, undefined);
    }
  });
  // Bearer tokens, not cookies. Reflect only the allowlist: Pages, loopback, and a missing or null origin (Electron file://).
  void app.register(cors, {
    origin: (origin, cb) => { cb(null, isAllowedApiOrigin(origin)); },
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['authorization', 'content-type', 'x-admin-key'],
    credentials: false,
  });
  const livekit = new RoomServiceClient(cfg.livekitHttpUrl, cfg.apiKey, cfg.apiSecret);
  const rooms: RoomAdmin = cfg.roomAdmin ?? livekit;
  const allCall = cfg.allCall ?? liveKitAllCall(livekit);
  /** Forwards created for this process, so stop removes those rooms even if the client lists a different set later. */
  const allCallLeases = new Map<string, { sourceRoom: string; destinations: string[] }>();

  const write = cfg.log ?? ((line: string) => console.log(line));
  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Cache-Control', 'no-store');
  });
  app.addHook('onResponse', (req, reply, done) => {
    const path = (req.url ?? '/').split('?')[0];
    const ms = Math.max(0, Math.round(reply.elapsedTime));
    write(`${req.method} ${path} ${reply.statusCode} ${ms}ms`);
    done();
  });

  const phonePairs = new PhonePairs();
  const challenges = new ChallengeTable();
  const makeLimiter = (max: number) => {
    const hits = new Map<string, number[]>();
    const cap = cfg.maxTrackedIps ?? 10_000;
    return (req: FastifyRequest) => {
      const now = Date.now();
      const ip = req.ip;
      if (hits.size >= cap && !hits.has(ip)) {
        const oldest = hits.keys().next().value;
        if (oldest) hits.delete(oldest);
      }
      const arr = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
      arr.push(now);
      hits.set(ip, arr);
      if (arr.length > max) throw new HttpError(429, 'Too many attempts, wait a minute');
    };
  };
  const rateLimit = makeLimiter(cfg.joinRateLimit ?? 10);
  const globalLimit = makeLimiter(cfg.globalRateLimit ?? 120);
  app.addHook('onRequest', async (req) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/health') return;
    globalLimit(req);
  });

  const bearer = (req: FastifyRequest) => {
    const h = req.headers.authorization;
    return h?.startsWith('Bearer ') ? h.slice(7) : null;
  };

  const sessionFor = (req: FastifyRequest): Session => {
    const t = bearer(req);
    if (!t) throw new HttpError(401, 'Not signed in');
    const s = verifySession(t, cfg.apiSecret);
    if (!s) throw new HttpError(401, 'Session expired, rejoin this server');
    return s;
  };

  /**
   * A session scoped to :cid.
   * Device tokens skip the invite epoch and fail when the device row is missing or revoked.
   * Legacy tokens (no did) still follow the epoch until they expire.
   */
  const member = (req: FastifyRequest, cid: string): { user: RadioUser; community: Community; device?: Device; session: Session } => {
    const s = sessionFor(req);
    const community = store.getCommunity(cid);
    if (!community || s.cid !== cid) throw new HttpError(404, 'Community not found');
    if (s.did) {
      const device = store.getDevice(cid, s.did);
      if (!device || device.revokedAt) throw new HttpError(401, 'This device was removed. Ask an admin for an invite.');
      store.touchDevice(cid, s.did);
      return { community, device, session: s, user: { id: liveKitIdentity(s), displayName: device.callsign, tags: [] } };
    }
    if ((s.epoch ?? 0) !== (community.sessionEpoch ?? 0)) throw new HttpError(401, 'This invite was rotated. Join again.');
    return { community, session: s, user: { id: s.sid, displayName: s.name, tags: [] } };
  };

  const adminKeyHeader = (req: FastifyRequest): string | undefined => {
    const key = req.headers['x-admin-key'];
    const presented = Array.isArray(key) ? key[0] : key;
    if (typeof presented !== 'string' || presented.length === 0 || presented.length > 200) return undefined;
    return presented;
  };

  /** Break-glass admin key, or a device access token whose row is admin and not revoked. */
  const requireAdmin = (req: FastifyRequest, cid: string): { community: Community; actor: string } => {
    const community = store.getCommunity(cid);
    if (!community) throw new HttpError(404, 'Community not found');
    const presented = adminKeyHeader(req);
    if (presented && adminKeyMatches(presented, community.adminKeyHash)) return { community, actor: 'admin-key' };
    const token = bearer(req);
    if (token) {
      const s = verifySession(token, cfg.apiSecret);
      if (s?.did && s.cid === cid) {
        const device = store.getDevice(cid, s.did);
        if (device && !device.revokedAt && device.role === 'admin') return { community, actor: device.id };
      }
    }
    throw new HttpError(403, 'Admin key required');
  };

  const checkSetup = (setupCode: string | undefined) => {
    if (cfg.communitySetupCode && !secretEquals(setupCode ?? '', cfg.communitySetupCode))
      throw new HttpError(403, 'That setup code is not right');
  };

  const issueDeviceSession = (community: Community, device: Device) => {
    const exp = Math.floor(Date.now() / 1000) + DEVICE_SESSION_TTL_SECONDS;
    const session: Session = {
      cid: community.id,
      name: device.callsign,
      sid: randomUUID(),
      exp,
      iat: Math.floor(Date.now() / 1000),
      scope: 'member',
      did: device.id,
    };
    return {
      token: signSession(session, cfg.apiSecret),
      expiresAt: new Date(exp * 1000).toISOString(),
      callsign: device.callsign,
      role: device.role,
      deviceId: device.id,
      community: publicCommunity(community),
    };
  };

  const dropDevice = async (communityId: string, deviceId: string) => {
    if (!rooms.removeParticipant) return;
    const identity = `d${deviceId}`;
    const phoneRoom = phoneRoomName(communityId, identity);
    const kicks = [
      ...store.list(communityId).map((ch) => rooms.removeParticipant!(roomNameFor(ch), identity)),
      rooms.removeParticipant!(phoneRoom, identity),
      rooms.removeParticipant!(phoneRoom, phoneIdentity(identity)),
    ];
    await Promise.all(kicks.map((kick) => kick.catch(() => undefined)));
  };

  app.setErrorHandler((err, _req, reply: FastifyReply) => {
    if (err instanceof HttpError) {
      return reply.code(err.status).send({
        error: err.message,
        ...(err.code ? { code: err.code } : {}),
        ...(err.communityId ? { communityId: err.communityId } : {}),
      });
    }
    if (err instanceof IdentityError) {
      const status = err.code === 'revoked' ? 403 : err.code === 'invalid' ? 400 : err.code === 'rate' ? 429 : 404;
      return reply.code(status).send({ error: err.message });
    }
    if (err instanceof ChannelError) {
      const status = err.code === 'not_found' ? 404 : err.code === 'conflict' ? 409 : 400;
      return reply.code(status).send({ error: err.message });
    }
    if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Bad request', issues: err.issues });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: (err as Error).message });
    reply.code(500).send({ error: 'Something went wrong' });
  });

  app.get('/health', async () => ({ ok: true, identity: 1 }));

  app.get('/api/join/policy', async () => ({ powBits: POW_BITS }));

  /**
   * Create a community. Returns the admin key once (store it on the creating PC; share it with other admins).
   * Does not start a voice session — the app joins with the new invite code and the local callsign.
   */
  app.post('/api/communities', async (req, reply) => {
    rateLimit(req);
    const body = z.object({ name: z.string().max(64), setupCode: z.string().max(128).optional() }).parse(req.body);
    checkSetup(body.setupCode);
    const name = cleanLabel(body.name);
    if (!name) throw new HttpError(400, 'Community name must be 1-32 characters');
    const adminKey = newAdminKey();
    const community: Community = {
      id: randomUUID().slice(0, 8),
      name,
      band: DEFAULT_BAND,
      inviteCode: newInviteCode(),
      adminKeyHash: hashAdminKey(adminKey),
      createdAt: new Date().toISOString(),
    };
    store.upsertCommunity(community);
    return reply.code(201).send({ adminKey, community: publicCommunity(community, true) });
  });

  /**
   * Closed. Old clients typed an invite and became a member. That door does not mint a session
   * and does not consume an invite use. New clients enroll a device, or migrate a still-valid legacy token.
   */
  app.post('/api/join', async (req) => {
    rateLimit(req);
    throw new HttpError(410, LEGACY_JOIN_MESSAGE, 'device_signin');
  });

  /**
   * Enroll a new device with an invite. An id that is already on the server gets no session:
   * the client must sign a fresh challenge. The community id is in that refusal.
   */
  app.post('/api/join/register', async (req) => {
    rateLimit(req);
    const body = z.object({
      inviteCode: z.string().min(1).max(64),
      callsign: z.string().max(64),
      deviceId: z.string().length(64),
      publicKeySpki: z.string().min(1).max(512),
    }).parse(req.body);
    const spki = parseDeviceKey(body.deviceId, body.publicKeySpki);
    const callsign = cleanLabel(body.callsign);
    if (!callsign) throw new HttpError(400, 'Pick a callsign (1-32 characters)');
    const invite = store.usableInvite(normaliseInvite(body.inviteCode));
    if (!invite) throw new HttpError(404, "That invite code doesn't match any community");
    const community = store.getCommunity(invite.communityId);
    if (!community) throw new HttpError(404, "That invite code doesn't match any community");
    const existing = store.getDevice(community.id, body.deviceId);
    if (existing?.revokedAt) throw new HttpError(403, 'This device was removed. Ask an admin for an invite.');
    if (existing) throw new HttpError(409, 'This device is already enrolled.', 'already_enrolled', community.id);
    const device = store.enrollDevice({
      communityId: community.id,
      inviteId: invite.id,
      deviceId: body.deviceId,
      publicKeySpki: spki.toString('base64'),
      callsign,
      consumeUse: true,
    });
    return issueDeviceSession(community, device);
  });

  /**
   * Bind one new device to a still-valid legacy session, then burn that session id.
   * A second device from the same token is refused. An already-enrolled device gets no session.
   */
  app.post('/api/join/migrate', async (req) => {
    rateLimit(req);
    const session = sessionFor(req);
    if (session.did) throw new HttpError(400, 'This device is already signed in');
    const community = store.getCommunity(session.cid);
    if (!community) throw new HttpError(404, 'Community not found');
    if ((session.epoch ?? 0) !== (community.sessionEpoch ?? 0)) throw new HttpError(401, 'This invite was rotated. Join again.');
    const body = z.object({
      deviceId: z.string().length(64),
      publicKeySpki: z.string().min(1).max(512),
      callsign: z.string().max(64).optional(),
    }).parse(req.body);
    const spki = parseDeviceKey(body.deviceId, body.publicKeySpki);
    const callsign = cleanLabel(body.callsign ?? session.name);
    if (!callsign) throw new HttpError(400, 'Pick a callsign (1-32 characters)');
    const existing = store.getDevice(community.id, body.deviceId);
    if (existing?.revokedAt) throw new HttpError(403, 'This device was removed. Ask an admin for an invite.');
    if (store.legacyMigrationBurned(session.sid)) {
      throw new HttpError(409, 'This sign-in was already moved to a device.', 'migrate_used');
    }
    if (existing) {
      store.burnLegacyMigration(session.sid, community.id, null);
      throw new HttpError(409, 'This device is already enrolled.', 'already_enrolled', community.id);
    }
    const invite = store.inviteForCommunityCode(community);
    if (!invite || invite.revokedAt || (invite.maxUses !== null && invite.uses >= invite.maxUses)) {
      throw new HttpError(404, "That invite code doesn't match any community");
    }
    const device = store.enrollDevice({
      communityId: community.id,
      inviteId: invite.id,
      deviceId: body.deviceId,
      publicKeySpki: spki.toString('base64'),
      callsign,
      consumeUse: true,
    });
    store.burnLegacyMigration(session.sid, community.id, device.id);
    return issueDeviceSession(community, device);
  });

  /** Whoever has the server setup code can replace a lost admin key. The previous key stops working. */
  app.post<{ Params: { cid: string } }>('/api/communities/:cid/admin/rotate', async (req) => {
    rateLimit(req);
    const body = z.object({ setupCode: z.string().max(128).optional() }).parse(req.body ?? {});
    if (!cfg.communitySetupCode) throw new HttpError(403, 'This server has no setup code, so the admin key cannot be rotated here');
    checkSetup(body.setupCode);
    const community = store.getCommunity(req.params.cid);
    if (!community) throw new HttpError(404, 'Community not found');
    const adminKey = newAdminKey();
    community.adminKeyHash = hashAdminKey(adminKey);
    store.upsertCommunity(community);
    return { adminKey };
  });

  app.post<{ Params: { cid: string } }>('/api/communities/:cid/invite/rotate', async (req) => {
    const { community, actor } = requireAdmin(req, req.params.cid);
    const channelRooms = store.list(community.id).map(roomNameFor);
    try {
      await dropCommunityRooms(rooms, community.id, channelRooms);
    } catch {
      throw new HttpError(503, 'Could not remove people from voice. Try again.');
    }
    const invite = store.replacePrimaryInvite(community, actor);
    return { inviteCode: invite.code };
  });

  app.post<{ Params: { cid: string } }>('/api/communities/:cid/challenge', async (req) => {
    rateLimit(req);
    const body = z.object({ deviceId: z.string().length(64) }).parse(req.body);
    const community = store.getCommunity(req.params.cid);
    if (!community) throw new HttpError(404, 'Community not found');
    const device = store.getDevice(community.id, body.deviceId);
    if (!device || device.revokedAt) throw new HttpError(404, NOT_ENROLLED);
    return challenges.issue(community.id, body.deviceId);
  });

  app.post<{ Params: { cid: string } }>('/api/communities/:cid/join', async (req) => {
    rateLimit(req);
    const body = z.object({
      challengeId: z.string().min(1).max(80),
      deviceId: z.string().length(64),
      callsign: z.string().max(64).optional(),
      signature: z.string().min(1).max(128),
    }).parse(req.body);
    const community = store.getCommunity(req.params.cid);
    if (!community) throw new HttpError(404, 'Community not found');
    const device = store.getDevice(community.id, body.deviceId);
    if (!device || device.revokedAt) throw new HttpError(404, NOT_ENROLLED);
    const callsign = body.callsign === undefined ? device.callsign : cleanLabel(body.callsign);
    if (!callsign) throw new HttpError(400, 'Pick a callsign (1-32 characters)');
    const nonce = challenges.take(body.challengeId, community.id, body.deviceId);
    if (!nonce) throw new HttpError(401, 'That sign-in challenge expired. Try again.');
    const signature = decodeSignature(body.signature);
    const message = canonicalJoin(body.challengeId, nonce, community.id, body.deviceId);
    const spki = Buffer.from(device.publicKeySpki, 'base64');
    if (!signature || !verifyJoinSignature(spki, message, signature)) throw new HttpError(401, 'Signature was not accepted');
    const current = callsign === device.callsign ? device : store.setDeviceCallsign(community.id, device.id, callsign);
    if (callsign === device.callsign) store.touchDevice(community.id, device.id);
    return issueDeviceSession(community, current);
  });

  app.get<{ Params: { cid: string } }>('/api/communities/:cid/devices', async (req) => {
    const { community } = requireAdmin(req, req.params.cid);
    const invites = new Map(store.listInvites(community.id).map((invite) => [invite.id, invite]));
    return {
      devices: store.listDevices(community.id).map((device) => ({
        deviceId: device.id,
        shortId: device.id.slice(-8),
        callsign: device.callsign,
        role: device.role,
        createdAt: device.createdAt,
        lastSeenAt: device.lastSeenAt,
        revokedAt: device.revokedAt,
        inviteId: device.inviteId,
        inviteLabel: invites.get(device.inviteId)?.label ?? null,
      })),
    };
  });

  app.post<{ Params: { cid: string; deviceId: string } }>('/api/communities/:cid/devices/:deviceId/revoke', async (req) => {
    const { community } = requireAdmin(req, req.params.cid);
    const device = store.setDeviceRevoked(community.id, req.params.deviceId, true);
    await dropDevice(community.id, device.id);
    return { deviceId: device.id, revokedAt: device.revokedAt };
  });

  app.post<{ Params: { cid: string; deviceId: string } }>('/api/communities/:cid/devices/:deviceId/restore', async (req) => {
    const { community } = requireAdmin(req, req.params.cid);
    const device = store.setDeviceRevoked(community.id, req.params.deviceId, false);
    return { deviceId: device.id, revokedAt: device.revokedAt };
  });

  app.post<{ Params: { cid: string; deviceId: string } }>('/api/communities/:cid/devices/:deviceId/role', async (req) => {
    const { community } = requireAdmin(req, req.params.cid);
    const body = z.object({ role: z.enum(['admin', 'member']) }).parse(req.body);
    const device = store.setDeviceRole(community.id, req.params.deviceId, body.role);
    return { deviceId: device.id, role: device.role };
  });

  app.post<{ Params: { cid: string } }>('/api/communities/:cid/claim-admin', async (req) => {
    rateLimit(req);
    const { community, device } = member(req, req.params.cid);
    if (!device) throw new HttpError(400, 'Sign in with this device first');
    const presented = adminKeyHeader(req);
    if (!presented || !adminKeyMatches(presented, community.adminKeyHash)) throw new HttpError(403, 'Admin key required');
    const updated = store.setDeviceRole(community.id, device.id, 'admin');
    return { role: updated.role, deviceId: updated.id };
  });

  app.get<{ Params: { cid: string } }>('/api/communities/:cid/invites', async (req) => {
    const { community } = requireAdmin(req, req.params.cid);
    return { invites: store.listInvites(community.id).map(publicInvite) };
  });

  app.post<{ Params: { cid: string } }>('/api/communities/:cid/invites', async (req, reply) => {
    const { community, actor } = requireAdmin(req, req.params.cid);
    const body = z.object({
      label: z.string().max(64).optional(),
      maxUses: z.number().int().positive().max(1_000_000).nullable().optional(),
      expiresAt: z.string().max(40).nullable().optional(),
    }).parse(req.body ?? {});
    const rawLabel = (body.label ?? '').trim().replace(/\s+/g, ' ');
    if (rawLabel.length > 32) throw new HttpError(400, 'Invite label must be 32 characters or fewer');
    let expiresAt: string | null = null;
    if (body.expiresAt) {
      const at = Date.parse(body.expiresAt);
      if (!Number.isFinite(at) || at <= Date.now()) throw new HttpError(400, 'Invite expiry must be in the future');
      expiresAt = new Date(at).toISOString();
    }
    const invite = store.createInvite({
      communityId: community.id,
      label: rawLabel || null,
      maxUses: body.maxUses ?? null,
      expiresAt,
      createdBy: actor,
    });
    return reply.code(201).send({ invite: publicInvite(invite) });
  });

  app.post<{ Params: { cid: string; inviteId: string } }>('/api/communities/:cid/invites/:inviteId/revoke', async (req) => {
    const { community } = requireAdmin(req, req.params.cid);
    return { invite: publicInvite(store.revokeInvite(community.id, req.params.inviteId)) };
  });

  app.get<{ Params: { cid: string } }>('/api/communities/:cid/channels', async (req) => {
    member(req, req.params.cid);
    return { channels: store.list(req.params.cid).map(publicChannel) };
  });

  app.get<{ Params: { cid: string }; Querystring: { q?: string } }>('/api/communities/:cid/channels/resolve', async (req) => {
    member(req, req.params.cid);
    const q = req.query.q ?? '';
    if (q.length > 64) throw new HttpError(400, 'Bad request');
    return { matches: store.resolve(req.params.cid, q).map(publicChannel) };
  });

  app.post<{ Params: { cid: string } }>('/api/communities/:cid/channels', async (req, reply) => {
    requireAdmin(req, req.params.cid);
    const body = z.object({ freq: z.union([z.string().max(32), z.number()]), name: z.string().max(64) }).parse(req.body);
    const ch = store.create(req.params.cid, body, 'admin');
    return reply.code(201).send({ channel: publicChannel(ch) });
  });

  app.delete<{ Params: { cid: string; chid: string } }>('/api/communities/:cid/channels/:chid', async (req, reply) => {
    requireAdmin(req, req.params.cid);
    const ch = store.delete(req.params.cid, req.params.chid);
    await rooms.deleteRoom(roomNameFor(ch)).catch(() => undefined);
    return reply.code(204).send();
  });

  /** Remove the community and every channel. Admin key only; there is no account that owns it. */
  app.delete<{ Params: { cid: string } }>('/api/communities/:cid', async (req, reply) => {
    requireAdmin(req, req.params.cid);
    const channels = store.list(req.params.cid);
    store.deleteCommunity(req.params.cid);
    await Promise.all(channels.map((ch) => rooms.deleteRoom(roomNameFor(ch)).catch(() => undefined)));
    return reply.code(204).send();
  });

  /**
   * Admin all-call. The signed-in session supplies the LiveKit identity.
   * Room Service then marks that participant and forwards them into the other tuned channel rooms.
   * A client that only unmutes its own mic does not get this path.
   */
  app.post<{ Params: { cid: string } }>('/api/communities/:cid/radio/all-call', async (req) => {
    const { user } = member(req, req.params.cid);
    requireAdmin(req, req.params.cid);
    const body = z.object({
      active: z.boolean(),
      sourceChannelId: z.string().min(1).max(64),
      channelIds: z.array(z.string().min(1).max(64)).min(1).max(16),
    }).parse(req.body);
    const key = `${req.params.cid}\0${user.id}`;
    const lease = allCallLeases.get(key);
    const quiet = async (job: Promise<void>) => {
      try { await job; } catch (err) { if (!allCallUnavailable(err)) throw err; }
    };
    const end = async (sourceRoom: string, destinations: readonly string[]) => {
      for (const dest of destinations) await quiet(allCall.stop(dest, user.id));
      await quiet(allCall.mark(sourceRoom, user.id, false));
      allCallLeases.delete(key);
    };
    if (!body.active) {
      if (lease) {
        try {
          await end(lease.sourceRoom, lease.destinations);
        } catch {
          write(`all-call ${req.params.cid} stop failed`);
          throw new HttpError(502, 'All-call did not stop. Try again.');
        }
        return { ok: true };
      }
    }
    const plan = planAllCall(body.sourceChannelId, body.channelIds, store.list(req.params.cid));
    if (plan === 'empty') throw new HttpError(400, 'Choose at least one tuned channel.');
    if (plan === 'too_many') throw new HttpError(400, 'All-call covers at most 16 channels.');
    if (plan === 'unknown') throw new HttpError(400, 'That channel is not in this community.');
    if (plan === 'source') throw new HttpError(400, 'All-call has to include the channel you are transmitting on.');
    if (!body.active) {
      try {
        await end(plan.sourceRoom, plan.destinations);
      } catch {
        write(`all-call ${req.params.cid} stop failed`);
        throw new HttpError(502, 'All-call did not stop. Try again.');
      }
      return { ok: true };
    }
    if (lease) {
      try {
        for (const dest of lease.destinations) await quiet(allCall.stop(dest, user.id));
      } catch {
        write(`all-call ${req.params.cid} start failed`);
        throw new HttpError(502, 'All-call did not start. Try again.');
      }
      allCallLeases.delete(key);
    }
    const started: string[] = [];
    try {
      await allCall.mark(plan.sourceRoom, user.id, true);
      for (const dest of plan.destinations) {
        await allCall.forward(plan.sourceRoom, user.id, dest);
        started.push(dest);
      }
    } catch (err) {
      for (const dest of started) await quiet(allCall.stop(dest, user.id)).catch(() => undefined);
      await quiet(allCall.mark(plan.sourceRoom, user.id, false)).catch(() => undefined);
      allCallLeases.delete(key);
      write(`all-call ${req.params.cid} start failed`);
      if (allCallUnavailable(err)) throw new HttpError(409, 'Tune the channel and connect before all-call.');
      throw new HttpError(502, 'All-call did not start. Try again.');
    }
    allCallLeases.set(key, { sourceRoom: plan.sourceRoom, destinations: plan.destinations });
    return { ok: true };
  });

  /** Tune: tokens for the channels in my radio. Called on start and whenever the user tunes a new channel. */
  app.post<{ Params: { cid: string } }>('/api/communities/:cid/radio/tokens', async (req) => {
    rateLimit(req);
    const { user } = member(req, req.params.cid);
    const body = z.object({ channelIds: z.array(z.string().max(64)).max(16) }).parse(req.body);
    const chans = body.channelIds.map((id) => store.get(req.params.cid, id)).filter((c): c is Channel => Boolean(c));
    const grants = await mintChannelGrants({ apiKey: cfg.apiKey, apiSecret: cfg.apiSecret, user, channels: chans });
    return { livekitUrl: cfg.livekitUrl, grants };
  });

  /** The computer joins a data-only room so a paired phone can key the mic already published on the voice rooms. */
  app.post<{ Params: { cid: string } }>('/api/communities/:cid/radio/phone-host', async (req) => {
    const { user } = member(req, req.params.cid);
    const room = phoneRoomName(req.params.cid, user.id);
    const token = await mintPhoneToken({
      apiKey: cfg.apiKey, apiSecret: cfg.apiSecret, room, identity: user.id, name: user.displayName,
    });
    return { livekitUrl: cfg.livekitUrl, room, token, phoneIdentity: phoneIdentity(user.id) };
  });

  /** One-time code for the QR. It expires in two minutes and works once. */
  app.post<{ Params: { cid: string } }>('/api/communities/:cid/radio/phone-pair', async (req) => {
    const { user, community } = member(req, req.params.cid);
    rateLimit(req);
    return phonePairs.issue({
      cid: req.params.cid, sid: user.id, name: user.displayName, epoch: community.sessionEpoch ?? 0,
    });
  });

  /** The phone trades the code for a data-only token. It does not receive the computer's session. */
  app.post('/api/phone/redeem', async (req) => {
    rateLimit(req);
    const body = z.object({ code: z.string().min(8).max(80) }).parse(req.body);
    const subject = phonePairs.take(body.code);
    const community = subject ? store.getCommunity(subject.cid) : undefined;
    if (!subject || !community || (subject.epoch ?? 0) !== (community.sessionEpoch ?? 0)) {
      throw new HttpError(404, 'That pairing code is not valid');
    }
    const deviceId = /^d([0-9a-f]{64})$/.exec(subject.sid)?.[1];
    if (deviceId) {
      const device = store.getDevice(subject.cid, deviceId);
      if (!device || device.revokedAt) throw new HttpError(404, 'That pairing code is not valid');
    }
    const room = phoneRoomName(subject.cid, subject.sid);
    const token = await mintPhoneToken({
      apiKey: cfg.apiKey, apiSecret: cfg.apiSecret, room,
      identity: phoneIdentity(subject.sid), name: `${subject.name} phone`,
    });
    return {
      livekitUrl: cfg.livekitUrl, room, token,
      identity: phoneIdentity(subject.sid),
      callsign: subject.name,
      communityId: subject.cid,
      communityName: community.name,
    };
  });

  return app;
}
