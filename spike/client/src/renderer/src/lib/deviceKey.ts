import { bytesToBase64, deviceIdForSpki } from '../../../shared/identity';

const DB_NAME = 'radionet-identity';
const STORE = 'keys';

export interface HeldDevice {
  deviceId: string;
  publicKeySpki: string;
  privateKey: CryptoKey;
}

interface StoredDevice extends HeldDevice {
  createdAt: string;
}

/** A key that still exists as PKCS#8, before it is imported as non-extractable. */
export interface PendingDevice {
  deviceId: string;
  publicKeySpki: string;
  pkcs8: Uint8Array;
}

export async function loadDevice(): Promise<HeldDevice | null> {
  const row = await idbGet();
  if (!row?.privateKey || row.privateKey.extractable) {
    if (row?.privateKey?.extractable) await idbDelete();
    return null;
  }
  return { deviceId: row.deviceId, publicKeySpki: row.publicKeySpki, privateKey: row.privateKey };
}

export async function createExtractable(): Promise<PendingDevice> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  return { deviceId: await deviceIdForSpki(spki), publicKeySpki: bytesToBase64(spki), pkcs8 };
}

/** Import as non-extractable and store that key. The caller drops the PKCS#8 bytes. */
export async function commitDevice(pending: PendingDevice): Promise<HeldDevice> {
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    pending.pkcs8.slice(),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  if (privateKey.extractable) throw new Error('This browser could not store a non-extractable device key.');
  const row: StoredDevice = {
    deviceId: pending.deviceId,
    publicKeySpki: pending.publicKeySpki,
    privateKey,
    createdAt: new Date().toISOString(),
  };
  await idbPut(row);
  return { deviceId: row.deviceId, publicKeySpki: row.publicKeySpki, privateKey };
}

export async function signCanonical(privateKey: CryptoKey, message: string): Promise<string> {
  const sig = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(message),
  ));
  return bytesToBase64(sig);
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open the device key database'));
  });
}

async function idbGet(): Promise<StoredDevice | undefined> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get('self');
      req.onsuccess = () => resolve(req.result as StoredDevice | undefined);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function idbPut(row: StoredDevice): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const req = db.transaction(STORE, 'readwrite').objectStore(STORE).put(row, 'self');
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function idbDelete(): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const req = db.transaction(STORE, 'readwrite').objectStore(STORE).delete('self');
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}
