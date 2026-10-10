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
export function phonePageUrl(opts: {
  code: string;
  apiBase: string;
  electron: boolean;
  origin: string;
  base: string;
  /** ISO time from the pairing response, so the phone can show the same two-minute clock. */
  expiresAt?: string;
}): string {
  const root = opts.electron ? PAGES_ROOT : joinBase(opts.origin, opts.base);
  const api = encodeURIComponent(opts.apiBase);
  const expMs = opts.expiresAt ? Date.parse(opts.expiresAt) : NaN;
  const exp = Number.isFinite(expMs) ? `&exp=${expMs}` : '';
  return `${root}#/p/${encodeURIComponent(opts.code)}?api=${api}${exp}`;
}

function joinBase(origin: string, base: string): string {
  const path = base.startsWith('/') ? base : `/${base}`;
  const withSlash = path.endsWith('/') ? path : `${path}/`;
  return `${origin}${withSlash}`;
}

export function parsePhoneHash(hash: string): { code: string; api: string | null; expiresAt: number | null } | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const match = /^\/p\/([^?]+)/.exec(raw);
  if (!match) return null;
  let code = '';
  try { code = decodeURIComponent(match[1]); } catch { return null; }
  if (code.length < 8 || code.length > 80) return null;
  const query = raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : '';
  const params = new URLSearchParams(query);
  const api = params.get('api');
  if (api && !/^https?:\/\//i.test(api)) return null;
  const exp = params.get('exp');
  const expiresAt = exp && /^\d+$/.test(exp) ? Number(exp) : null;
  return { code, api: api ? allowedPhoneApi(api) : null, expiresAt };
}

/** `m:ss` for the two-minute pairing code. */
export function formatCodeClock(remainingMs: number): string {
  const total = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** What the computer says while the QR is on screen. */
export function phoneHostStatus(input: {
  linked: boolean;
  makingCode: boolean;
  remainingMs: number | null;
  tuned: boolean;
}): string {
  if (input.makingCode) return 'Making a code…';
  if (input.linked && input.tuned) return 'Phone connected. Hold the button on the phone.';
  if (input.linked) return 'Phone connected. Tune a channel on this computer. The phone will show it.';
  if (input.remainingMs != null && input.remainingMs <= 0) return 'This code expired. Choose New code and scan again.';
  if (input.remainingMs != null) return `On the phone, tap Connect. This code expires in ${formatCodeClock(input.remainingMs)}.`;
  return 'On the phone, tap Connect. The code expires in two minutes.';
}

export type PhonePhase = 'idle' | 'connecting' | 'live' | 'error';

/**
 * Not a channel. The phone sends this as a tx id so the computer replies with its radio.
 * The installed desktop app already answers any tx message by sending the snapshot.
 */
export const PHONE_SYNC_ID = 'rn-sync';

/** Hold stays off until the phone has joined the computer. The transmitting label is the desktop's ack. */
export function phoneHold(phase: PhonePhase, onAir: boolean, freq?: string | null): { label: string; enabled: boolean } {
  if (phase === 'live' && onAir) return { label: freq ? `TRANSMITTING on ${freq}` : 'TRANSMITTING', enabled: true };
  if (phase === 'live') return { label: 'Hold to talk', enabled: true };
  if (phase === 'connecting') return { label: 'Connecting…', enabled: false };
  return { label: 'Tap Connect first', enabled: false };
}

/** Shown in place of the channel list until the computer has something tuned. */
export function phoneChannelNote(phase: PhonePhase, channelCount: number): string | null {
  if (phase !== 'live') return null;
  if (channelCount === 0) return 'Connected. Tune a channel on the computer.';
  return null;
}

export function phoneExpiryNote(remainingMs: number | null, phase: PhonePhase): string | null {
  if (phase === 'live' || phase === 'connecting') return null;
  if (remainingMs == null) return 'The code expires two minutes after the computer showed it. Tap Connect before then.';
  if (remainingMs <= 0) return 'This code expired. On the computer, choose New code and scan again.';
  return `This code expires in ${formatCodeClock(remainingMs)}. Tap Connect before then.`;
}

/** A failed redeem should say the code is finished, which is what the server means by "not valid". */
export function phoneRedeemError(message: string): string {
  if (/not valid|expired|already used/i.test(message)) {
    return 'This code expired or was already used. On the computer, choose New code and scan again.';
  }
  return message;
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
