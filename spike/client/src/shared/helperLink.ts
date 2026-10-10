/** Local helper window. It watches the keys set in that window and sends talk and channel actions. It does not see the microphone. */
export const HELPER_URL = 'ws://127.0.0.1:47321';

/**
 * Download for one immutable helper-N release. A newer approved build is a new tag,
 * and this constant is updated to that tag after the tag exists. It does not use
 * /releases/latest, because that address follows whichever release is newest,
 * including the desktop installer. The file is not listed in latest.yml.
 */
export const HELPER_DOWNLOAD_URL = 'https://github.com/Tubss2/radio-net/releases/download/helper-4/RadioNetHelper.exe';

/** Open-source helper window. */
export const HELPER_SOURCE_URL = 'https://github.com/Tubss2/radio-net/tree/main/helper';

export const HELPER_FALLBACK = "The helper isn't running. Download it, open the window, then try again.";

const STORAGE_KEY = 'rn.helper';
const CODE_ALPHABET = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{12}$/;

/** The helper shows a 12-character code. Anything shorter is not sent. */
export function isHelperCode(code: string): boolean {
  return CODE_ALPHABET.test(code.trim().toUpperCase());
}

/**
 * The helper's Open Radio Net button puts the one-time code in the URL fragment.
 * Fragments are not sent to the server. The page reads it once and then removes it.
 */
export function helperCodeFromHash(hash: string): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const code = new URLSearchParams(raw).get('h')?.trim().toUpperCase() ?? '';
  return isHelperCode(code) ? code : null;
}

/** The pairing message is the code only. The page does not name a key. */
export function helperPairMessage(code: string): string {
  return JSON.stringify({ t: 'pair', code });
}

export function helperResumeMessage(token: string): string {
  return JSON.stringify({ t: 'resume', token });
}

export function helperForgetMessage(): string {
  return JSON.stringify({ t: 'forget' });
}

export interface StoredHelper {
  token: string;
}

/** The browser keeps the token for this origin. Older saves also had a key name; that part is ignored. */
export function readHelperDevice(getItem: (key: string) => string | null): StoredHelper | null {
  let raw: unknown;
  try { raw = JSON.parse(getItem(STORAGE_KEY) || 'null'); } catch { return null; }
  if (!raw || typeof raw !== 'object') return null;
  const token = (raw as { token?: unknown }).token;
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return { token };
}

export function writeHelperDevice(setItem: (key: string, value: string) => void, device: StoredHelper): void {
  setItem(STORAGE_KEY, JSON.stringify({ token: device.token }));
}

export function forgetHelperDevice(removeItem: (key: string) => void): void {
  removeItem(STORAGE_KEY);
}

export type HelperEvent =
  | { t: 'ok'; token: string | null }
  | { t: 'ptt'; down: boolean }
  | { t: 'tx'; dir: 'next' | 'prev' }
  | { t: 'denied' };

/** Actions only. A frame that names a key or button is ignored. */
export function parseHelperEvent(text: string): HelperEvent | null {
  if (text.includes('"code"') || text.includes('"vk"') || text.includes('"button"') || text.includes('"watch"')) return null;
  let row: unknown;
  try { row = JSON.parse(text); } catch { return null; }
  if (!row || typeof row !== 'object' || !('t' in row)) return null;
  const kind = (row as { t: unknown }).t;
  if (kind === 'down' || kind === 'ptt' && (row as { v?: unknown }).v === 'down') return { t: 'ptt', down: true };
  if (kind === 'up' || kind === 'ptt' && (row as { v?: unknown }).v === 'up') return { t: 'ptt', down: false };
  if (kind === 'tx') {
    const dir = (row as { v?: unknown }).v;
    if (dir === 'next' || dir === 'prev') return { t: 'tx', dir };
  }
  if (kind === 'denied') return { t: 'denied' };
  if (kind === 'ok') {
    const token = (row as { token?: unknown }).token;
    const kept = typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
    return { t: 'ok', token: kept };
  }
  return null;
}
