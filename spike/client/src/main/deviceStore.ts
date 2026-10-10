import {
  createDeviceMaterial,
  DEVICE_KEY_UNREADABLE,
  isJoinMessage,
  parseDeviceRecord,
  serialiseDeviceRecord,
  SIGN_REFUSED,
  signJoin,
  type DeviceMaterial,
  type DevicePublic,
} from './deviceKey';

export interface DeviceKeyIo {
  read: () => Buffer | null;
  write: (data: Buffer) => void;
  canEncrypt: () => boolean;
  encrypt: (text: string) => Buffer;
  decrypt: (data: Buffer) => string;
  log: (line: string) => void;
}

/**
 * One P-256 key for this PC.
 * The encrypted file is written only when the OS can seal it.
 * A file that will not open is never replaced.
 */
export class DeviceKeyStore {
  private memory: DeviceMaterial | null = null;
  private loggedMemory = false;
  private loggedUnreadable = false;

  constructor(private io: DeviceKeyIo) {}

  ensure(): DevicePublic {
    const material = this.current();
    return { deviceId: material.deviceId, publicKeySpki: material.publicKeySpki };
  }

  sign(message: string): string {
    const material = this.current();
    if (!isJoinMessage(message, material.deviceId)) throw new Error(SIGN_REFUSED);
    return signJoin(material.pkcs8, message);
  }

  private current(): DeviceMaterial {
    if (this.memory) return this.memory;
    const existing = this.io.read();
    if (existing) {
      const opened = this.open(existing);
      this.memory = opened;
      return opened;
    }
    const created = createDeviceMaterial();
    if (this.io.canEncrypt()) {
      this.io.write(this.io.encrypt(serialiseDeviceRecord(created)));
    } else if (!this.loggedMemory) {
      this.loggedMemory = true;
      this.io.log('OS encryption unavailable; device key stays in memory for this run');
    }
    this.memory = created;
    return created;
  }

  private open(existing: Buffer): DeviceMaterial {
    if (!this.io.canEncrypt()) this.failUnreadable();
    let text: string;
    try {
      text = this.io.decrypt(existing);
    } catch {
      this.failUnreadable();
    }
    const material = parseDeviceRecord(text);
    if (!material) this.failUnreadable();
    return material;
  }

  private failUnreadable(): never {
    if (!this.loggedUnreadable) {
      this.loggedUnreadable = true;
      this.io.log('could not open device key');
    }
    throw new Error(DEVICE_KEY_UNREADABLE);
  }
}
