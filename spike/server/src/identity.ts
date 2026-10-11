import { createHash, createPublicKey, randomBytes, randomUUID, verify, type KeyObject } from 'node:crypto';

/** ECDSA P-256 with SHA-256. Ed25519 is out of this version. */
export const DEVICE_SESSION_TTL_SECONDS = 60 * 60;
export const CHALLENGE_TTL_MS = 60_000;
export const CHALLENGE_CAP = 10_000;
export const DEVICE_CHALLENGE_PER_MINUTE = 30;
export const SPKI_MAX_BYTES = 256;
/** Proof of work stays off. A later release can turn a flag on; this one does not. */
export const POW_BITS = 0;

const DEVICE_ID_RE = /^[0-9a-f]{64}$/;

export class IdentityError extends Error {
  constructor(
    public code: 'invite' | 'revoked' | 'invalid' | 'not_found' | 'rate',
    message: string,
  ) {
    super(message);
  }
}

/** UTF-8 signed text. Newline between fields, no trailing newline. */
export function canonicalJoin(challengeId: string, nonce: string, communityId: string, deviceId: string): string {
  for (const field of [challengeId, nonce, communityId, deviceId]) {
    if (field.includes('\n') || field.includes('\r')) throw new IdentityError('invalid', 'That sign-in challenge expired. Try again.');
  }
  return `rn-join.v1\n${challengeId}\n${nonce}\n${communityId}\n${deviceId}`;
}

export function deviceIdForSpki(spki: Buffer): string {
  return createHash('sha256').update(spki).digest('hex');
}

/** Decode a client SPKI, require P-256, and require the claimed id to be the hash of those bytes. */
export function parseDeviceKey(deviceId: string, publicKeySpki: string): Buffer {
  if (!DEVICE_ID_RE.test(deviceId)) throw new IdentityError('invalid', 'That device key is not valid');
  const spki = Buffer.from(publicKeySpki, 'base64');
  if (spki.length === 0 || spki.length > SPKI_MAX_BYTES) throw new IdentityError('invalid', 'That device key is not valid');
  if (deviceIdForSpki(spki) !== deviceId) throw new IdentityError('invalid', 'That device key is not valid');
  let key: KeyObject;
  try {
    key = createPublicKey({ key: spki, format: 'der', type: 'spki' });
  } catch {
    throw new IdentityError('invalid', 'That device key is not valid');
  }
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw new IdentityError('invalid', 'That device key is not valid');
  }
  return spki;
}

/** IEEE P1363 (r || s), 64 bytes, which is what WebCrypto produces for P-256. */
export function verifyJoinSignature(spki: Buffer, message: string, signature: Buffer): boolean {
  if (signature.length !== 64) return false;
  let key: KeyObject;
  try {
    key = createPublicKey({ key: spki, format: 'der', type: 'spki' });
  } catch {
    return false;
  }
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') return false;
  try {
    return verify('sha256', Buffer.from(message, 'utf8'), { key, dsaEncoding: 'ieee-p1363' }, signature);
  } catch {
    return false;
  }
}

export function decodeSignature(signature: string): Buffer | null {
  if (!signature || signature.length > 128) return null;
  const bytes = Buffer.from(signature, 'base64');
  return bytes.length === 64 ? bytes : null;
}

interface ChallengeRow {
  nonce: string;
  communityId: string;
  deviceId: string;
  exp: number;
}

/**
 * In-memory sign-in challenges. Not written to store.json. A restart drops them.
 * One API process is assumed (Sydney).
 */
export class ChallengeTable {
  private rows = new Map<string, ChallengeRow>();
  private hits = new Map<string, number[]>();

  constructor(private now: () => number = Date.now) {}

  issue(communityId: string, deviceId: string): { challengeId: string; nonce: string; expiresAt: string } {
    const now = this.now();
    const recent = (this.hits.get(deviceId) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= DEVICE_CHALLENGE_PER_MINUTE) {
      throw new IdentityError('rate', 'Too many attempts, wait a minute');
    }
    recent.push(now);
    this.hits.set(deviceId, recent);

    for (const [id, row] of this.rows) {
      if (row.exp <= now) this.rows.delete(id);
    }
    while (this.rows.size >= CHALLENGE_CAP) {
      const oldest = this.rows.keys().next().value;
      if (!oldest) break;
      this.rows.delete(oldest);
    }

    const challengeId = randomUUID();
    const nonce = randomBytes(32).toString('base64url');
    const exp = now + CHALLENGE_TTL_MS;
    this.rows.set(challengeId, { nonce, communityId, deviceId, exp });
    return { challengeId, nonce, expiresAt: new Date(exp).toISOString() };
  }

  /** Single use. A mismatch, expiry, or unknown id returns null and the row is gone. */
  take(challengeId: string, communityId: string, deviceId: string): string | null {
    const row = this.rows.get(challengeId);
    if (!row) return null;
    this.rows.delete(challengeId);
    if (row.exp <= this.now()) return null;
    if (row.communityId !== communityId || row.deviceId !== deviceId) return null;
    return row.nonce;
  }
}
