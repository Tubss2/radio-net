import { createPublicKey, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJoin } from '../shared/identity';
import {
  createDeviceMaterial,
  deviceIdForSpki,
  isJoinMessage,
  parseDeviceRecord,
  serialiseDeviceRecord,
  signJoin,
} from './deviceKey';
import { DeviceKeyStore, type DeviceKeyIo } from './deviceStore';

function memoryIo(seed?: Buffer): DeviceKeyIo & { file: Buffer | null; writes: number; logs: string[] } {
  const state = { file: seed ?? null, writes: 0, logs: [] as string[] };
  return {
    get file() { return state.file; },
    set file(value: Buffer | null) { state.file = value; },
    get writes() { return state.writes; },
    logs: state.logs,
    read: () => state.file,
    write: (data) => { state.file = Buffer.from(data); state.writes += 1; },
    canEncrypt: () => true,
    encrypt: (text) => Buffer.from(`enc:${text}`, 'utf8'),
    decrypt: (data) => {
      const text = data.toString('utf8');
      if (!text.startsWith('enc:')) throw new Error('sealed');
      return text.slice(4);
    },
    log: (line) => { state.logs.push(line); },
  };
}

describe('device key', () => {
  it('signs the join string as 64-byte IEEE P1363 and the id is the SPKI hash', () => {
    const material = createDeviceMaterial();
    const spki = Buffer.from(material.publicKeySpki, 'base64');
    expect(material.deviceId).toBe(deviceIdForSpki(spki));
    const message = canonicalJoin('challenge', 'nonce', 'community', material.deviceId);
    const signature = Buffer.from(signJoin(material.pkcs8, message), 'base64');
    expect(signature.length).toBe(64);
    const pub = createPublicKey({ key: spki, format: 'der', type: 'spki' });
    expect(verify('sha256', Buffer.from(message, 'utf8'), { key: pub, dsaEncoding: 'ieee-p1363' }, signature)).toBe(true);
    expect(isJoinMessage(message, material.deviceId)).toBe(true);
    expect(isJoinMessage(message, 'ab'.repeat(32))).toBe(false);
    expect(isJoinMessage(`please-sign\n${material.deviceId}`, material.deviceId)).toBe(false);
    expect(isJoinMessage(`${message}\nextra`, material.deviceId)).toBe(false);
  });

  it('round-trips the sealed file and refuses to replace one that will not open', () => {
    const io = memoryIo();
    const store = new DeviceKeyStore(io);
    const first = store.ensure();
    expect(io.writes).toBe(1);
    expect(io.file?.toString('utf8').startsWith('enc:')).toBe(true);
    expect(first).not.toHaveProperty('pkcs8');
    const again = new DeviceKeyStore(memoryIo(io.file!)).ensure();
    expect(again).toEqual(first);

    const stuck = memoryIo(Buffer.from('not-sealed'));
    const logsBefore = stuck.logs.length;
    expect(() => new DeviceKeyStore(stuck).ensure()).toThrow(/left in place/);
    expect(stuck.writes).toBe(0);
    expect(stuck.logs.join(' ')).not.toMatch(/[A-Za-z0-9+/]{40,}/);
    expect(stuck.logs.length).toBe(logsBefore + 1);

    const plain = memoryIo(io.file!);
    plain.canEncrypt = () => false;
    expect(() => new DeviceKeyStore(plain).ensure()).toThrow(/left in place/);
    expect(plain.writes).toBe(0);

    const bad = memoryIo(Buffer.from(`enc:${JSON.stringify({ v: 1, pkcs8: 'aa', deviceId: 'ab'.repeat(32), publicKeySpki: 'aa' })}`));
    expect(() => new DeviceKeyStore(bad).ensure()).toThrow(/left in place/);
    expect(bad.writes).toBe(0);
  });

  it('keeps a new key in memory when the OS cannot encrypt, and will not sign anything else', () => {
    const io = memoryIo();
    io.canEncrypt = () => false;
    const store = new DeviceKeyStore(io);
    const pub = store.ensure();
    expect(io.writes).toBe(0);
    expect(io.file).toBeNull();
    expect(io.logs[0]).toMatch(/memory/);
    expect(store.ensure().deviceId).toBe(pub.deviceId);
    const message = canonicalJoin('c', 'n', 'community', pub.deviceId);
    expect(store.sign(message).length).toBeGreaterThan(20);
    expect(() => store.sign('rn-join.v1\nother')).toThrow(/Refused/);
    const saved = serialiseDeviceRecord(createDeviceMaterial());
    const parsed = parseDeviceRecord(saved);
    expect(parsed?.deviceId).toHaveLength(64);
    const tampered = saved.replace(parsed!.deviceId, 'ab'.repeat(32));
    expect(parseDeviceRecord(tampered)).toBeNull();
  });
});
