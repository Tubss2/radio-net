import { randomBytes, timingSafeEqual } from 'node:crypto';

/** Must match the port named in the Pages connect-src. Do not widen it to every ws: host. */
export const HELPER_PORT = 47391;
export const HELPER_BIND_HOST = '127.0.0.1';
export const PAGES_ORIGIN = 'https://tubss2.github.io';

export function newHelperSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** One pairing secret. A wrong guess does not burn it. The first success does. */
export class HelperGate {
  readonly secret: string;
  private used = false;

  constructor(secret = newHelperSecret()) {
    this.secret = secret;
  }

  authorize(presented: string): boolean {
    const got = Buffer.from(presented);
    const want = Buffer.from(this.secret);
    const sameLength = got.length === want.length;
    const match = timingSafeEqual(sameLength ? got : want, want) && sameLength;
    const ok = match && !this.used;
    if (ok) this.used = true;
    return ok;
  }

  get spent(): boolean {
    return this.used;
  }
}

/** Missing Origin is a reject. Browsers send Origin on a WebSocket handshake. "null" is not the Pages site. */
export function isAllowedHelperOrigin(origin: string | undefined | null): boolean {
  if (!origin || origin === 'null') return false;
  if (origin === PAGES_ORIGIN) return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

/**
 * DNS rebinding keeps the attacker's Host name while the TCP peer is loopback.
 * The name has to be loopback. The port may vary (tests bind an ephemeral port);
 * the process still listens on 127.0.0.1 only.
 */
export function isLoopbackHost(host: string | undefined | null): boolean {
  if (!host) return false;
  let name = host.trim().toLowerCase();
  if (name.startsWith('[')) return false;
  const colon = name.lastIndexOf(':');
  if (colon !== -1) {
    const port = name.slice(colon + 1);
    if (!/^\d+$/.test(port)) return false;
    name = name.slice(0, colon);
  }
  return name === '127.0.0.1' || name === 'localhost';
}

/** Private Network Access headers for one allowlisted origin. Never `*`. */
export function privateNetworkHeaders(origin: string | undefined | null): Record<string, string> | null {
  if (!isAllowedHelperOrigin(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin as string,
    'Access-Control-Allow-Private-Network': 'true',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    Vary: 'Origin',
  };
}

export function upgradeAllowed(origin: string | undefined | null, host: string | undefined | null): boolean {
  return isAllowedHelperOrigin(origin) && isLoopbackHost(host);
}

/** Outbound talk event. There is no field for a key code. */
export function talkMessage(down: boolean): string {
  return JSON.stringify({ type: 'talk', down: Boolean(down) });
}
