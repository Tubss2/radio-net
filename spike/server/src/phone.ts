import { createHash, randomBytes } from 'node:crypto';
import { AccessToken } from 'livekit-server-sdk';

/** How long a QR code can be redeemed. One use. */
export const PHONE_CODE_TTL_MS = 2 * 60 * 1000;
/** How long the phone may hold the push-to-talk link after it redeems the code. */
export const PHONE_TOKEN_TTL_SECONDS = 2 * 60 * 60;

export interface PhoneSubject {
  cid: string;
  sid: string;
  name: string;
}

interface PairRow extends PhoneSubject {
  exp: number;
}

/** One-time pairing codes. The plaintext code is never stored. */
export class PhonePairs {
  private rows = new Map<string, PairRow>();
  constructor(private now: () => number = Date.now) {}

  issue(subject: PhoneSubject, ttlMs = PHONE_CODE_TTL_MS): { code: string; expiresAt: string } {
    const now = this.now();
    for (const [hash, row] of this.rows) {
      if (row.exp <= now || (row.sid === subject.sid && row.cid === subject.cid)) this.rows.delete(hash);
    }
    const code = randomBytes(32).toString('base64url');
    const exp = now + ttlMs;
    this.rows.set(hashCode(code), { ...subject, exp });
    return { code, expiresAt: new Date(exp).toISOString() };
  }

  /** Single use. An expired or unknown code returns null and is forgotten. */
  take(code: string): PhoneSubject | null {
    const hash = hashCode(code);
    const row = this.rows.get(hash);
    if (!row) return null;
    this.rows.delete(hash);
    if (row.exp <= this.now()) return null;
    return { cid: row.cid, sid: row.sid, name: row.name };
  }
}

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/** Control room for one visit. Voice rooms stay separate; this room carries data only. */
export function phoneRoomName(cid: string, sid: string): string {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(cid) || !/^[A-Za-z0-9_-]{1,80}$/.test(sid)) {
    throw new Error('bad phone room');
  }
  return `g${cid}.phone.${sid}`;
}

export function phoneIdentity(sid: string): string {
  return `phone:${sid}`;
}

/** Data-only LiveKit grant. The phone cannot publish a microphone. */
export async function mintPhoneToken(opts: {
  apiKey: string;
  apiSecret: string;
  room: string;
  identity: string;
  name: string;
  ttlSeconds?: number;
}): Promise<string> {
  const at = new AccessToken(opts.apiKey, opts.apiSecret, {
    identity: opts.identity,
    name: opts.name,
    ttl: opts.ttlSeconds ?? PHONE_TOKEN_TTL_SECONDS,
  });
  at.addGrant({
    room: opts.room,
    roomJoin: true,
    canSubscribe: true,
    canPublish: false,
    canPublishSources: [],
    canPublishData: true,
    canUpdateOwnMetadata: false,
  });
  return at.toJwt();
}
