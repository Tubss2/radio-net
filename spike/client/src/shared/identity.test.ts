import { describe, expect, it } from 'vitest';
import { canonicalJoin, tokenHasDevice, unwrapIdentity, wrapIdentity } from './identity';

describe('device identity backup', () => {
  it('signs a stable challenge string and round-trips a wrapped key', async () => {
    expect(canonicalJoin('c', 'n', 'community', 'ab')).toBe('rn-join.v1\nc\nn\ncommunity\nab');
    expect(canonicalJoin('c', 'n', 'community', 'ab').endsWith('\n')).toBe(false);
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
    const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
    const { deviceIdForSpki, bytesToBase64 } = await import('./identity');
    const deviceId = await deviceIdForSpki(spki);
    const file = await wrapIdentity(pkcs8, 'correct horse', deviceId, bytesToBase64(spki));
    expect(file.salt).not.toBe((await wrapIdentity(pkcs8, 'correct horse', deviceId, bytesToBase64(spki))).salt);
    const opened = await unwrapIdentity(file, 'correct horse');
    expect(opened.deviceId).toBe(deviceId);
    await expect(unwrapIdentity(file, 'wrong passphrase here')).rejects.toThrow(/passphrase/);
    const header = Buffer.from(JSON.stringify({ did: deviceId, sid: 'x' })).toString('base64url');
    expect(tokenHasDevice(`${header}.mac`)).toBe(true);
    expect(tokenHasDevice(`${Buffer.from(JSON.stringify({ sid: 'only' })).toString('base64url')}.mac`)).toBe(false);
  });
});
