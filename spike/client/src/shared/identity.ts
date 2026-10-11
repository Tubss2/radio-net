/** Canonical sign-in string. Newline between fields, no trailing newline. Must match the server. */
export function canonicalJoin(challengeId: string, nonce: string, communityId: string, deviceId: string): string {
  return `rn-join.v1\n${challengeId}\n${nonce}\n${communityId}\n${deviceId}`;
}

export const BACKUP_ITERATIONS = 600_000;

export interface IdentityBackup {
  v: 1;
  kdf: 'PBKDF2-SHA-256';
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
  deviceId: string;
  publicKeySpki: string;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let raw = '';
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw);
}

export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const raw = atob(value);
  const buffer = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function deviceIdForSpki(spki: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', spki);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** True when this HMAC session was minted for an enrolled device. */
export function tokenHasDevice(token: string): boolean {
  const part = token.split('.')[0] ?? '';
  try {
    const padded = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(padded)) as { did?: unknown };
    return typeof json.did === 'string' && /^[0-9a-f]{64}$/.test(json.did);
  } catch {
    return false;
  }
}

/**
 * Wrap PKCS#8 for a file the person saves. Salt and IV are new every time.
 * The passphrase is not stored. The caller drops the PKCS#8 bytes after this returns.
 */
export async function wrapIdentity(pkcs8: Uint8Array, passphrase: string, deviceId: string, publicKeySpki: string): Promise<IdentityBackup> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aes = await deriveAes(passphrase, salt, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, pkcs8.slice()));
  return {
    v: 1,
    kdf: 'PBKDF2-SHA-256',
    iterations: BACKUP_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
    deviceId,
    publicKeySpki,
  };
}

export async function unwrapIdentity(file: IdentityBackup, passphrase: string): Promise<{ deviceId: string; publicKeySpki: string; pkcs8: Uint8Array }> {
  if (file?.v !== 1 || file.kdf !== 'PBKDF2-SHA-256' || file.iterations !== BACKUP_ITERATIONS) {
    throw new Error('That backup is not a Radio Net identity file.');
  }
  const salt = base64ToBytes(file.salt);
  const iv = base64ToBytes(file.iv);
  if (iv.length !== 12) throw new Error('That backup is not a Radio Net identity file.');
  let pkcs8: Uint8Array;
  try {
    const aes = await deriveAes(passphrase, salt, ['decrypt']);
    pkcs8 = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aes, base64ToBytes(file.ciphertext)));
  } catch {
    throw new Error('That passphrase did not open this backup.');
  }
  const spki = base64ToBytes(file.publicKeySpki);
  const id = await deviceIdForSpki(spki);
  if (id !== file.deviceId) throw new Error('That backup does not match its device id.');
  const signing = await crypto.subtle.importKey('pkcs8', pkcs8.slice(), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const verify = await crypto.subtle.importKey('spki', spki.slice(), { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
  const probe = new TextEncoder().encode('rn-backup-check');
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signing, probe);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verify, sig, probe);
  if (!ok) throw new Error('That backup does not match its device id.');
  return { deviceId: file.deviceId, publicKeySpki: file.publicKeySpki, pkcs8 };
}

async function deriveAes(passphrase: string, salt: Uint8Array<ArrayBuffer>, usages: KeyUsage[]): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt.slice(), iterations: BACKUP_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    usages,
  );
}
