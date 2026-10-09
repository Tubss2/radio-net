import cors from '@fastify/cors';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { RoomServiceClient } from 'livekit-server-sdk';
import { z } from 'zod';
import {
  SESSION_TTL_SECONDS, adminKeyMatches, cleanLabel, hashAdminKey, newAdminKey, newInviteCode, normaliseInvite,
  signSession, verifySession, type Session,
} from './accounts.js';
import { DEFAULT_BAND, formatFrequency } from './freq.js';
import { type Channel, ChannelError, type ChannelStore, type Community, roomNameFor } from './store.js';
import { type RadioUser, mintChannelGrants } from './tokens.js';

export interface AppConfig {
  livekitUrl: string; // ws(s)://... handed to clients
  livekitHttpUrl: string; // http(s)://... for RoomService admin calls
  apiKey: string;
  apiSecret: string;
  /** If set, creating a community (or rotating its admin key) needs this code. Unset = open (dev). */
  communitySetupCode?: string;
  /** Join/create attempts allowed per IP per minute. */
  joinRateLimit?: number;
  /** Trust X-Forwarded-For from a local reverse proxy (Caddy) so rate limits see real client IPs. */
  trustProxy?: boolean;
}

const publicChannel = (c: Channel) => ({
  id: c.id, freqKHz: c.freqKHz, freq: formatFrequency(c.freqKHz), name: c.name, restricted: c.restrictedTag !== null,
});

/** Invite code is returned because the caller already used it, or they just created the community. The admin key hash stays on the server. */
const publicCommunity = (c: Community) => ({
  id: c.id, name: c.name, band: c.band, inviteCode: c.inviteCode,
});

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function buildApp(store: ChannelStore, cfg: AppConfig): FastifyInstance {
  const app = Fastify({ logger: false, trustProxy: cfg.trustProxy ?? false });
  // Bearer-token API (no cookies), so allowing any origin is safe; the desktop app loads from file://.
  void app.register(cors, { origin: true, methods: ['GET', 'POST', 'DELETE'] });
  const rooms = new RoomServiceClient(cfg.livekitHttpUrl, cfg.apiKey, cfg.apiSecret);

  const hits = new Map<string, number[]>();
  const limit = cfg.joinRateLimit ?? 10;
  const rateLimit = (req: FastifyRequest) => {
    const now = Date.now();
    const arr = (hits.get(req.ip) ?? []).filter((t) => now - t < 60_000);
    arr.push(now);
    hits.set(req.ip, arr);
    if (arr.length > limit) throw new HttpError(429, 'Too many attempts, wait a minute');
  };

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

  /** A join session scoped to :cid. There is no account behind it. */
  const member = (req: FastifyRequest, cid: string): { user: RadioUser; community: Community } => {
    const s = sessionFor(req);
    const community = store.getCommunity(cid);
    if (!community || s.cid !== cid) throw new HttpError(404, 'Community not found');
    return { community, user: { id: s.sid, displayName: s.name, tags: [] } };
  };

  const requireAdmin = (req: FastifyRequest, cid: string): Community => {
    const community = store.getCommunity(cid);
    if (!community) throw new HttpError(404, 'Community not found');
    const key = req.headers['x-admin-key'];
    const presented = Array.isArray(key) ? key[0] : key;
    if (!presented || !adminKeyMatches(presented, community.adminKeyHash))
      throw new HttpError(403, 'Admin key required');
    return community;
  };

  const checkSetup = (setupCode: string | undefined) => {
    if (cfg.communitySetupCode && setupCode !== cfg.communitySetupCode)
      throw new HttpError(403, 'That setup code is not right');
  };

  const issueSession = (community: Community, callsign: string) => {
    const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
    const session: Session = { cid: community.id, name: callsign, sid: randomUUID(), exp };
    return {
      token: signSession(session, cfg.apiSecret),
      expiresAt: new Date(exp * 1000).toISOString(),
      callsign,
      community: publicCommunity(community),
    };
  };

  app.setErrorHandler((err, _req, reply: FastifyReply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    if (err instanceof ChannelError) {
      const status = err.code === 'not_found' ? 404 : err.code === 'conflict' ? 409 : 400;
      return reply.code(status).send({ error: err.message });
    }
    if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Bad request', issues: err.issues });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: (err as Error).message });
    reply.code(500).send({ error: 'Something went wrong' });
  });

  app.get('/health', async () => ({ ok: true }));

  /**
   * Create a community. Returns the admin key once (store it on the creating PC; share it with other admins).
   * Does not start a voice session — the app joins with the new invite code and the local callsign.
   */
  app.post('/api/communities', async (req, reply) => {
    rateLimit(req);
    const body = z.object({ name: z.string(), setupCode: z.string().optional() }).parse(req.body);
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
    return reply.code(201).send({ adminKey, community: publicCommunity(community) });
  });

  /** Join with an invite code and a callsign. Returns a short-lived session, not an account. */
  app.post('/api/join', async (req) => {
    rateLimit(req);
    const body = z.object({ inviteCode: z.string(), callsign: z.string() }).parse(req.body);
    const community = store.communityByInvite(normaliseInvite(body.inviteCode));
    if (!community) throw new HttpError(404, "That invite code doesn't match any community");
    const callsign = cleanLabel(body.callsign);
    if (!callsign) throw new HttpError(400, 'Pick a callsign (1-32 characters)');
    return issueSession(community, callsign);
  });

  /** Whoever has the server setup code can replace a lost admin key. The previous key stops working. */
  app.post<{ Params: { cid: string } }>('/api/communities/:cid/admin/rotate', async (req) => {
    rateLimit(req);
    const body = z.object({ setupCode: z.string().optional() }).parse(req.body ?? {});
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
    const community = requireAdmin(req, req.params.cid);
    community.inviteCode = newInviteCode();
    store.upsertCommunity(community);
    return { inviteCode: community.inviteCode };
  });

  app.get<{ Params: { cid: string } }>('/api/communities/:cid/channels', async (req) => {
    member(req, req.params.cid);
    return { channels: store.list(req.params.cid).map(publicChannel) };
  });

  app.get<{ Params: { cid: string }; Querystring: { q?: string } }>('/api/communities/:cid/channels/resolve', async (req) => {
    member(req, req.params.cid);
    return { matches: store.resolve(req.params.cid, req.query.q ?? '').map(publicChannel) };
  });

  app.post<{ Params: { cid: string } }>('/api/communities/:cid/channels', async (req, reply) => {
    requireAdmin(req, req.params.cid);
    const body = z.object({ freq: z.union([z.string(), z.number()]), name: z.string() }).parse(req.body);
    const ch = store.create(req.params.cid, body, 'admin');
    return reply.code(201).send({ channel: publicChannel(ch) });
  });

  app.delete<{ Params: { cid: string; chid: string } }>('/api/communities/:cid/channels/:chid', async (req, reply) => {
    requireAdmin(req, req.params.cid);
    const ch = store.delete(req.params.cid, req.params.chid);
    await rooms.deleteRoom(roomNameFor(ch)).catch(() => undefined);
    return reply.code(204).send();
  });

  /** Tune: tokens for the channels in my radio. Called on start and whenever the user tunes a new channel. */
  app.post<{ Params: { cid: string } }>('/api/communities/:cid/radio/tokens', async (req) => {
    const { user } = member(req, req.params.cid);
    const body = z.object({ channelIds: z.array(z.string()).max(16) }).parse(req.body);
    const chans = body.channelIds.map((id) => store.get(req.params.cid, id)).filter((c): c is Channel => Boolean(c));
    const grants = await mintChannelGrants({ apiKey: cfg.apiKey, apiSecret: cfg.apiSecret, user, channels: chans });
    return { livekitUrl: cfg.livekitUrl, grants };
  });

  return app;
}
