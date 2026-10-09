import cors from '@fastify/cors';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { RoomServiceClient } from 'livekit-server-sdk';
import { z } from 'zod';
import {
  type Account, MemoryAccountStore, type Role, cleanDisplayName, newInviteCode, normaliseInvite,
} from './accounts.js';
import { DEFAULT_BAND, formatFrequency } from './freq.js';
import { type Channel, ChannelError, type ChannelStore, type Community, roomNameFor } from './store.js';
import { type RadioUser, isAdmin, mintChannelGrants } from './tokens.js';
import { randomUUID } from 'node:crypto';

export interface AppConfig {
  livekitUrl: string; // ws(s)://... handed to clients
  livekitHttpUrl: string; // http(s)://... for RoomService admin calls
  apiKey: string;
  apiSecret: string;
  /** If set, creating a community needs this code (stops randoms using our server). Unset = open (dev). */
  communitySetupCode?: string;
  /** Join/create attempts allowed per IP per minute. */
  joinRateLimit?: number;
}

const publicChannel = (c: Channel) => ({
  id: c.id, freqKHz: c.freqKHz, freq: formatFrequency(c.freqKHz), name: c.name, restricted: c.restrictedTag !== null,
});
const publicCommunity = (c: Community, role: Role) => ({
  id: c.id, name: c.name, role, band: c.band, ...(role !== 'member' ? { inviteCode: c.inviteCode } : {}),
});

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function buildApp(store: ChannelStore, cfg: AppConfig, accounts = new MemoryAccountStore()): FastifyInstance {
  const app = Fastify({ logger: false });
  // Bearer-token API (no cookies), so allowing any origin is safe; the desktop app loads from file://.
  void app.register(cors, { origin: true, methods: ['GET', 'POST', 'PATCH', 'DELETE'] });
  const rooms = new RoomServiceClient(cfg.livekitHttpUrl, cfg.apiKey, cfg.apiSecret);

  // --- tiny per-IP limiter for invite-code guessing ---
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
  const optionalAccount = (req: FastifyRequest): Account | null => {
    const t = bearer(req);
    if (!t) return null;
    const a = accounts.byToken(t);
    if (!a) throw new HttpError(401, 'Sign-in expired, please rejoin');
    return a;
  };
  const requireAccount = (req: FastifyRequest): Account => {
    const a = optionalAccount(req);
    if (!a) throw new HttpError(401, 'Not signed in');
    return a;
  };
  /** Account + their membership of :cid, as a RadioUser. */
  const member = (req: FastifyRequest, cid: string): { user: RadioUser; community: Community } => {
    const a = requireAccount(req);
    const community = store.getCommunity(cid);
    const m = community && accounts.membership(cid, a.id);
    if (!community || !m) throw new HttpError(404, 'Community not found');
    return { community, user: { id: a.id, displayName: a.displayName, role: m.role, tags: [] } };
  };
  const admin = (req: FastifyRequest, cid: string, what: string) => {
    const r = member(req, cid);
    if (!isAdmin(r.user)) throw new HttpError(403, `Only community admins can ${what}`);
    return r;
  };
  /** Use the caller's account, or create one from a display name (first run). */
  const accountOrNew = (req: FastifyRequest, displayName?: string) => {
    const existing = optionalAccount(req);
    if (existing) return { account: existing, token: undefined as string | undefined };
    const name = cleanDisplayName(displayName ?? '');
    if (!name) throw new HttpError(400, 'Pick a display name (1-32 characters)');
    return accounts.createAccount(name);
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

  // ---------- accounts & communities ----------

  /** Create a community. Caller becomes owner. First-time users also pass displayName and get a device token back. */
  app.post('/api/communities', async (req, reply) => {
    rateLimit(req);
    const body = z.object({ name: z.string(), displayName: z.string().optional(), setupCode: z.string().optional() }).parse(req.body);
    if (cfg.communitySetupCode && body.setupCode !== cfg.communitySetupCode)
      throw new HttpError(403, 'That setup code is not right');
    const name = cleanDisplayName(body.name);
    if (!name) throw new HttpError(400, 'Community name must be 1-32 characters');
    const { account, token } = accountOrNew(req, body.displayName);
    const community: Community = { id: randomUUID().slice(0, 8), name, band: DEFAULT_BAND, inviteCode: newInviteCode(), createdAt: new Date().toISOString() };
    store.upsertCommunity(community);
    accounts.addMembership(community.id, account.id, 'owner');
    return reply.code(201).send({ account: { id: account.id, displayName: account.displayName }, token, community: publicCommunity(community, 'owner') });
  });

  /** Join with an invite code. */
  app.post('/api/join', async (req) => {
    rateLimit(req);
    const body = z.object({ inviteCode: z.string(), displayName: z.string().optional() }).parse(req.body);
    const community = store.communityByInvite(normaliseInvite(body.inviteCode));
    if (!community) throw new HttpError(404, "That invite code doesn't match any community");
    const { account, token } = accountOrNew(req, body.displayName);
    const m = accounts.addMembership(community.id, account.id, 'member');
    return { account: { id: account.id, displayName: account.displayName }, token, community: publicCommunity(community, m.role) };
  });

  app.get('/api/me', async (req) => {
    const a = requireAccount(req);
    const communities = accounts.membershipsOf(a.id)
      .map((m) => ({ m, c: store.getCommunity(m.communityId) }))
      .filter((x): x is { m: typeof x.m; c: Community } => Boolean(x.c))
      .map(({ m, c }) => publicCommunity(c, m.role));
    return { account: { id: a.id, displayName: a.displayName }, communities };
  });

  app.patch('/api/me', async (req) => {
    const a = requireAccount(req);
    const name = cleanDisplayName(z.object({ displayName: z.string() }).parse(req.body).displayName);
    if (!name) throw new HttpError(400, 'Display name must be 1-32 characters');
    a.displayName = name; // takes effect on next tune (LiveKit tokens carry the name)
    return { account: { id: a.id, displayName: a.displayName } };
  });

  app.post<{ Params: { cid: string } }>('/api/communities/:cid/invite/rotate', async (req) => {
    const { community } = admin(req, req.params.cid, 'change the invite code');
    community.inviteCode = newInviteCode();
    return { inviteCode: community.inviteCode };
  });

  app.get<{ Params: { cid: string } }>('/api/communities/:cid/members', async (req) => {
    member(req, req.params.cid);
    return {
      members: accounts.members(req.params.cid).map((m) => ({ id: m.accountId, displayName: accounts.get(m.accountId)?.displayName, role: m.role })),
    };
  });

  /** Owner promotes/demotes. */
  app.patch<{ Params: { cid: string; aid: string } }>('/api/communities/:cid/members/:aid', async (req) => {
    const { user } = member(req, req.params.cid);
    if (user.role !== 'owner') throw new HttpError(403, 'Only the owner can change roles');
    const role = z.object({ role: z.enum(['admin', 'member']) }).parse(req.body).role;
    const m = accounts.membership(req.params.cid, req.params.aid);
    if (!m) throw new HttpError(404, 'Member not found');
    if (m.role === 'owner') throw new HttpError(400, "The owner's role can't be changed");
    m.role = role;
    return { id: m.accountId, role: m.role };
  });

  /** Admin kicks a member (or anyone leaves: aid = self). Also drops them from every voice room now. */
  app.delete<{ Params: { cid: string; aid: string } }>('/api/communities/:cid/members/:aid', async (req, reply) => {
    const { user } = member(req, req.params.cid);
    const self = req.params.aid === user.id;
    if (!self && !isAdmin(user)) throw new HttpError(403, 'Only community admins can remove members');
    const m = accounts.membership(req.params.cid, req.params.aid);
    if (!m) throw new HttpError(404, 'Member not found');
    if (m.role === 'owner') throw new HttpError(400, 'The owner cannot be removed');
    if (!self && m.role === 'admin' && user.role !== 'owner') throw new HttpError(403, 'Only the owner can remove an admin');
    accounts.removeMembership(req.params.cid, req.params.aid);
    await Promise.all(store.list(req.params.cid).map((ch) => rooms.removeParticipant(roomNameFor(ch), req.params.aid).catch(() => undefined)));
    return reply.code(204).send();
  });

  // ---------- channels ----------

  app.get<{ Params: { cid: string } }>('/api/communities/:cid/channels', async (req) => {
    member(req, req.params.cid);
    return { channels: store.list(req.params.cid).map(publicChannel) };
  });

  app.get<{ Params: { cid: string }; Querystring: { q?: string } }>('/api/communities/:cid/channels/resolve', async (req) => {
    member(req, req.params.cid);
    return { matches: store.resolve(req.params.cid, req.query.q ?? '').map(publicChannel) };
  });

  app.post<{ Params: { cid: string } }>('/api/communities/:cid/channels', async (req, reply) => {
    const { user } = admin(req, req.params.cid, 'create channels');
    const body = z.object({ freq: z.union([z.string(), z.number()]), name: z.string() }).parse(req.body);
    const ch = store.create(req.params.cid, body, user.id);
    return reply.code(201).send({ channel: publicChannel(ch) });
  });

  app.delete<{ Params: { cid: string; chid: string } }>('/api/communities/:cid/channels/:chid', async (req, reply) => {
    admin(req, req.params.cid, 'delete channels');
    const ch = store.delete(req.params.cid, req.params.chid);
    // Kick everyone off the voice room. Ignore "room not found" (nobody was tuned in).
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
