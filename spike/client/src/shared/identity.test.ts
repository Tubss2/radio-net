import { describe, expect, it } from 'vitest';
import { canonicalJoin, tokenHasDevice, unwrapIdentity, wrapIdentity } from './identity';

describe('device identity', () => {
  it('builds the sign-in string the server checks, with no trailing newline', () => {
    const message = canonicalJoin('c', 'n', 'community', 'ab');
    expect(message).toBe('rn-join.v1\nc\nn\ncommunity\nab');
    expect(message.endsWith('\n')).toBe(false);
  });

  it('recognises a session that already names a device', () => {
    const deviceId = 'ab'.repeat(32);
    const header = Buffer.from(JSON.stringify({ did: deviceId, sid: 'x' })).toString('base64url');
    expect(tokenHasDevice(`${header}.mac`)).toBe(true);
    expect(tokenHasDevice(`${Buffer.from(JSON.stringify({ sid: 'only' })).toString('base64url')}.mac`)).toBe(false);
    expect(tokenHasDevice('not-a-token')).toBe(false);
  });

  it('round-trips a wrapped key and rejects the wrong passphrase', async () => {
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
  });
});
