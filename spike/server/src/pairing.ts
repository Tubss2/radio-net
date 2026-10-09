import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** QR secret lifetime. Shoulder-surfing and a forwarded link both die with this. */
export const PAIRING_TTL_MS = 2 * 60 * 1000;
/** How long a redeemed phone may hold the button. Invite rotation still kills it via epoch. */
export const PTT_TTL_SECONDS = 4 * 60 * 60;

export function newPairingSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function hashPairingSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function pairingFragment(secret: string): string {
  return `#pair=${secret}`;
}

/**
 * The secret lives in the URL fragment. Fragments are not sent to GitHub Pages or in Referer.
 * Any query string on the page URL is stripped so a caller cannot smuggle the secret into `?pair=`.
 */
export function pairingUrl(page: string, secret: string): string {
  const url = new URL(page);
  url.search = '';
  url.hash = pairingFragment(secret);
  return url.toString();
}

export interface PairingGrant {
  cid: string;
  parentSid: string;
  epoch: number;
}

interface PendingPair {
  hash: string;
  cid: string;
  parentSid: string;
  epoch: number;
  exp: number;
  used: boolean;
}

export class PairingTable {
  private rows: PendingPair[] = [];

  constructor(private now: () => number = Date.now) {}

  issue(input: { cid: string; parentSid: string; epoch: number }): { secret: string; fragment: string } {
    if (!input.cid || !input.parentSid || !Number.isInteger(input.epoch)) {
      throw new Error('pairing requires a community, a parent session, and an integer epoch');
    }
    this.sweep();
    const secret = newPairingSecret();
    this.rows.push({
      hash: hashPairingSecret(secret),
      cid: input.cid,
      parentSid: input.parentSid,
      epoch: input.epoch,
      exp: this.now() + PAIRING_TTL_MS,
      used: false,
    });
    return { secret, fragment: pairingFragment(secret) };
  }

  /** Single use. A second redeem, or a redeem after two minutes, fails. Only the hash is stored. */
  redeem(secret: string): PairingGrant | null {
    const got = Buffer.from(hashPairingSecret(secret), 'hex');
    let found: PendingPair | undefined;
    for (const row of this.rows) {
      const want = Buffer.from(row.hash, 'hex');
      if (want.length === got.length && timingSafeEqual(want, got)) found = row;
    }
    if (!found) {
      timingSafeEqual(got, got);
      return null;
    }
    const fresh = !found.used && found.exp > this.now();
    if (fresh) found.used = true;
    const grant = fresh ? { cid: found.cid, parentSid: found.parentSid, epoch: found.epoch } : null;
    this.sweep();
    return grant;
  }

  /** What is at rest. Hashes only, so a store dump is not a pile of QR secrets. */
  storedHashes(): string[] {
    return this.rows.map((row) => row.hash);
  }

  private sweep(): void {
    const now = this.now();
    this.rows = this.rows.filter((row) => !row.used && row.exp > now);
  }
}

export interface PttSession {
  scope: 'ptt';
  cid: string;
  parentSid: string;
  sid: string;
  epoch: number;
  iat: number;
  exp: number;
}

export function issuePttToken(grant: PairingGrant, secret: string, nowSec = Math.floor(Date.now() / 1000)): { token: string; session: PttSession } {
  const session: PttSession = {
    scope: 'ptt',
    cid: grant.cid,
    parentSid: grant.parentSid,
    sid: randomBytes(16).toString('base64url'),
    epoch: grant.epoch,
    iat: nowSec,
    exp: nowSec + PTT_TTL_SECONDS,
  };
  const body = Buffer.from(JSON.stringify(session)).toString('base64url');
  const mac = createHmac('sha256', secret).update(`ptt.${body}`).digest('base64url');
  return { token: `ptt.${body}.${mac}`, session };
}

/** Phone token. Scope is ptt only. Pass the community's current epoch so an invite rotation fails closed. */
export function verifyPtt(token: string, secret: string, opts?: { epoch?: number; now?: number }): PttSession | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'ptt') return null;
  const body = parts[1];
  const mac = parts[2];
  const expectMac = createHmac('sha256', secret).update(`ptt.${body}`).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expectMac);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let session: PttSession;
  try {
    session = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as PttSession;
  } catch {
    return null;
  }
  if (session?.scope !== 'ptt') return null;
  if (typeof session.cid !== 'string' || !session.cid) return null;
  if (typeof session.parentSid !== 'string' || !session.parentSid) return null;
  if (typeof session.sid !== 'string' || !session.sid) return null;
  if (!Number.isInteger(session.epoch) || !Number.isInteger(session.iat) || !Number.isInteger(session.exp)) return null;
  const now = opts?.now ?? Math.floor(Date.now() / 1000);
  if (session.exp <= now) return null;
  if (opts?.epoch !== undefined && session.epoch !== opts.epoch) return null;
  return session;
}
