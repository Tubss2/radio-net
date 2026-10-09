const PAGES_ROOT = 'https://tubss2.github.io/radio-net/';
const SYDNEY_API = 'https://radio-149-28-170-200.sslip.io';

/** The phone posts the pairing code here. Any other host is ignored so a rewritten link cannot collect it. */
export function allowedPhoneApi(api: string): string | null {
  let url: URL;
  try { url = new URL(api); } catch { return null; }
  if (url.username || url.password) return null;
  if (url.origin === SYDNEY_API) return url.origin;
  if (url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')) return url.origin;
  return null;
}

/** URL the phone opens. The code is one-time; the API origin tells the phone which server issued it. */
export function phonePageUrl(opts: { code: string; apiBase: string; electron: boolean; origin: string; base: string }): string {
  const root = opts.electron ? PAGES_ROOT : joinBase(opts.origin, opts.base);
  const api = encodeURIComponent(opts.apiBase);
  return `${root}#/p/${encodeURIComponent(opts.code)}?api=${api}`;
}

function joinBase(origin: string, base: string): string {
  const path = base.startsWith('/') ? base : `/${base}`;
  const withSlash = path.endsWith('/') ? path : `${path}/`;
  return `${origin}${withSlash}`;
}

export function parsePhoneHash(hash: string): { code: string; api: string | null } | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const match = /^\/p\/([^?]+)/.exec(raw);
  if (!match) return null;
  let code = '';
  try { code = decodeURIComponent(match[1]); } catch { return null; }
  if (code.length < 8 || code.length > 80) return null;
  const query = raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : '';
  const api = new URLSearchParams(query).get('api');
  if (api && !/^https?:\/\//i.test(api)) return null;
  return { code, api: api ? allowedPhoneApi(api) : null };
}

export interface PhoneChannel {
  id: string;
  freq: string;
  name: string;
  who: string[];
}

export interface PhoneState {
  t: 'state';
  tx: string | null;
  channels: PhoneChannel[];
  on: boolean;
}

export type PhoneToHost = { t: 'ptt'; down: boolean } | { t: 'tx'; id: string };
export type HostToPhone = PhoneState;

export function encodePhone(message: PhoneToHost | HostToPhone): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(JSON.stringify(message));
  const copy = new Uint8Array(new ArrayBuffer(encoded.byteLength));
  copy.set(encoded);
  return copy;
}

export function decodePhone(bytes: Uint8Array): PhoneToHost | HostToPhone | null {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== 'object') return null;
    const row = value as { t?: unknown; down?: unknown; id?: unknown; channels?: unknown; tx?: unknown; on?: unknown };
    if (row.t === 'ptt' && typeof row.down === 'boolean') return { t: 'ptt', down: row.down };
    if (row.t === 'tx' && typeof row.id === 'string' && row.id.length > 0 && row.id.length < 80) return { t: 'tx', id: row.id };
    if (row.t === 'state' && Array.isArray(row.channels) && (row.tx === null || typeof row.tx === 'string')) {
      const channels = row.channels.flatMap((itemRaw: unknown) => {
        if (!itemRaw || typeof itemRaw !== 'object') return [];
        const item = itemRaw as Partial<PhoneChannel>;
        if (typeof item.id !== 'string' || typeof item.freq !== 'string' || typeof item.name !== 'string') return [];
        const who = Array.isArray(item.who) ? item.who.filter((name) => typeof name === 'string').slice(0, 8) : [];
        return [{ id: item.id, freq: item.freq, name: item.name, who }];
      }).slice(0, 16);
      return { t: 'state', tx: row.tx, channels, on: row.on === true };
    }
    return null;
  } catch {
    return null;
  }
}
