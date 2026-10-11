import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * No email or password accounts. A person is a device key enrolled with an invite.
 * Day-to-day sessions are HMAC bearers (not stored) that name the device id.
 * Creating a community returns an admin key once; the server keeps only its SHA-256 hash.
 * Admin actions send that key back, or use a device whose row is role admin.
 */
export const CALLSIGN_MAX = 32;

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Invite codes: 8 chars from an unambiguous alphabet, shown as XXXX-XXXX. Joins are rate-limited. */
export function newInviteCode(): string {
  const b = randomBytes(8);
  const s = [...b].map((x) => ALPHABET[x % ALPHABET.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

export function normaliseInvite(code: string): string {
  const s = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4)}` : s;
}

/** Callsign or community name: trimmed, 1–32 characters. */
export function cleanLabel(name: string): string | null {
  const n = (name ?? '').trim().replace(/\s+/g, ' ');
  if (!n || n.length > CALLSIGN_MAX) return null;
  return n;
}

export function newAdminKey(): string {
  return `rnk_${randomBytes(32).toString('base64url')}`;
}

export function hashAdminKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/** Equal length is not required. Both sides are hashed so the compare does not leak the setup code. */
export function secretEquals(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function adminKeyMatches(key: string, hash: string): boolean {
  if (!key || hash.length !== 64) return false;
  const got = Buffer.from(hashAdminKey(key), 'hex');
  const want = Buffer.from(hash, 'hex');
  if (got.length !== want.length) return false;
  return timingSafeEqual(got, want);
}

/**
 * HMAC session. `sid` stays a random id on the token.
 * Device sessions set `did` and omit `epoch`. Their LiveKit identity is `d` + `did`.
 * Legacy sessions have no `did`. `sid` is their LiveKit identity, and `epoch` dies when the invite rotates.
 */
export interface Session {
  cid: string;
  name: string;
  sid: string;
  exp: number;
  /** Unix seconds, informational. */
  iat?: number;
  /** Join sessions are members. Anything else is rejected. */
  scope?: 'member';
  /** Legacy tokens only. Device tokens omit this so invite rotation does not log them out. */
  epoch?: number;
  /** Enrolled device id (64 hex). Present on device sessions. */
  did?: string;
}

export const SESSION_TTL_SECONDS = 12 * 60 * 60;

/** LiveKit identity. Device sessions stay the same participant across token refreshes. */
export function liveKitIdentity(session: Pick<Session, 'sid' | 'did'>): string {
  return session.did ? `d${session.did}` : session.sid;
}

export function signSession(session: Session, secret: string): string {
  const body = Buffer.from(JSON.stringify(session)).toString('base64url');
  const mac = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function verifySession(token: string, secret: string): Session | null {
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expect = createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let session: Session;
  try {
    session = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Session;
  } catch {
    return null;
  }
  if (typeof session?.cid !== 'string' || typeof session.name !== 'string' || typeof session.sid !== 'string') return null;
  if (session.cid.length > 64 || session.name.length > CALLSIGN_MAX || session.sid.length > 64) return null;
  if (typeof session.exp !== 'number' || session.exp < Math.floor(Date.now() / 1000)) return null;
  if (session.scope !== undefined && session.scope !== 'member') return null;
  if (session.epoch !== undefined && (typeof session.epoch !== 'number' || !Number.isInteger(session.epoch) || session.epoch < 0)) return null;
  if (session.did !== undefined && (typeof session.did !== 'string' || !/^[0-9a-f]{64}$/.test(session.did))) return null;
  return session;
}
