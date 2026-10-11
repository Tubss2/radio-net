import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';

/** Public half of this PC's device. Safe to hand to the renderer. */
export interface DevicePublic {
  deviceId: string;
  publicKeySpki: string;
}

/** Private key stays in the main process. Never send pkcs8 over IPC. */
export interface DeviceMaterial extends DevicePublic {
  pkcs8: Buffer;
}

export const DEVICE_KEY_UNREADABLE = 'The device key on this PC could not be opened. It was left in place.';
export const SIGN_REFUSED = 'Refused to sign that message.';

const SPKI_MAX = 256;
const PKCS8_MAX = 512;

export function deviceIdForSpki(spki: Buffer): string {
  return createHash('sha256').update(spki).digest('hex');
}

/** P-256 key. deviceId is the SHA-256 hex of the SPKI bytes. */
export function createDeviceMaterial(): DeviceMaterial {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  const pkcs8 = privateKey.export({ format: 'der', type: 'pkcs8' });
  const material = materialFromParts(pkcs8, spki, deviceIdForSpki(spki));
  if (!material) throw new Error('Could not create a device key.');
  return material;
}

/**
 * IEEE P1363 (r || s), 64 bytes, base64. Node's default ECDSA encoding is DER;
 * the server expects the raw form WebCrypto produces.
 */
export function signJoin(pkcs8: Buffer, message: string): string {
  const key = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
  return sign('sha256', Buffer.from(message, 'utf8'), { key, dsaEncoding: 'ieee-p1363' }).toString('base64');
}

/** Only the five-line join string, and only for this device. Not a general signing oracle. */
export function isJoinMessage(message: string, deviceId: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(deviceId)) return false;
  if (typeof message !== 'string' || message.length === 0 || message.length > 512) return false;
  if (message.includes('\r')) return false;
  const lines = message.split('\n');
  if (lines.length !== 5 || lines[0] !== 'rn-join.v1' || lines[4] !== deviceId) return false;
  return lines.slice(1, 4).every((line) => line.length > 0 && line.length <= 128);
}

export function materialFromParts(pkcs8: Buffer, spki: Buffer, claimedId: string): DeviceMaterial | null {
  if (spki.length === 0 || spki.length > SPKI_MAX || pkcs8.length === 0 || pkcs8.length > PKCS8_MAX) return null;
  if (!/^[0-9a-f]{64}$/.test(claimedId) || deviceIdForSpki(spki) !== claimedId) return null;
  try {
    const priv = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
    const pub = createPublicKey({ key: spki, format: 'der', type: 'spki' });
    if (priv.asymmetricKeyType !== 'ec' || priv.asymmetricKeyDetails?.namedCurve !== 'prime256v1') return null;
    if (pub.asymmetricKeyType !== 'ec' || pub.asymmetricKeyDetails?.namedCurve !== 'prime256v1') return null;
    const probe = Buffer.from('rn-device-check');
    const signature = sign('sha256', probe, { key: priv, dsaEncoding: 'ieee-p1363' });
    if (signature.length !== 64) return null;
    if (!verify('sha256', probe, { key: pub, dsaEncoding: 'ieee-p1363' }, signature)) return null;
    return { pkcs8, publicKeySpki: spki.toString('base64'), deviceId: claimedId };
  } catch {
    return null;
  }
}

/** Stored JSON. pkcs8 is base64 and only exists inside the encrypted file. */
export function parseDeviceRecord(text: string): DeviceMaterial | null {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as { v?: unknown; pkcs8?: unknown; deviceId?: unknown; publicKeySpki?: unknown };
  if (row.v !== 1 || typeof row.pkcs8 !== 'string' || typeof row.deviceId !== 'string' || typeof row.publicKeySpki !== 'string') return null;
  const pkcs8 = decodeLimited(row.pkcs8, PKCS8_MAX);
  const spki = decodeLimited(row.publicKeySpki, SPKI_MAX);
  if (!pkcs8 || !spki) return null;
  return materialFromParts(pkcs8, spki, row.deviceId);
}

export function serialiseDeviceRecord(material: DeviceMaterial): string {
  return JSON.stringify({
    v: 1,
    pkcs8: material.pkcs8.toString('base64'),
    deviceId: material.deviceId,
    publicKeySpki: material.publicKeySpki,
  });
}

function decodeLimited(value: string, max: number): Buffer | null {
  if (value.length === 0 || value.length > max * 2) return null;
  const buf = Buffer.from(value, 'base64');
  if (buf.length === 0 || buf.length > max) return null;
  return buf;
}
