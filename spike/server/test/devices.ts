import { createHash, generateKeyPairSync, type KeyObject } from 'node:crypto';

export function freshDevice(): { privateKey: KeyObject; deviceId: string; publicKeySpki: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  return { privateKey, deviceId: createHash('sha256').update(spki).digest('hex'), publicKeySpki: spki.toString('base64') };
}

type InjectApp = { inject: (opts: object) => Promise<{ statusCode: number; json: () => any; body: string }> };

export async function registerDevice(app: InjectApp, inviteCode: string, callsign: string, device = freshDevice()) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/join/register',
    payload: { inviteCode, callsign, deviceId: device.deviceId, publicKeySpki: device.publicKeySpki },
  });
  return { res, device };
}
