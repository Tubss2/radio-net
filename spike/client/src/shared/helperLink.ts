/** Local tray helper. It watches one key and sends press and release. It does not see the microphone. */
export const HELPER_URL = 'ws://127.0.0.1:47321';

/**
 * Stable download. The helper workflow attaches this file to the `helper-1` release.
 * It is not listed in `latest.yml`, so the desktop updater does not treat it as an app update.
 */
export const HELPER_DOWNLOAD_URL = 'https://github.com/Tubss2/radio-net/releases/download/helper-1/RadioNetHelper.exe';

/** Open-source tray program. */
export const HELPER_SOURCE_URL = 'https://github.com/Tubss2/radio-net/tree/main/helper';

export const HELPER_FALLBACK =
  'The helper is not running, or this browser blocked the localhost link. Use the phone button, or the desktop app, for in-game push-to-talk.';

export type HelperWatch =
  | { kind: 'key'; code: string }
  | { kind: 'mouse'; button: 4 | 5 };

/** Field order matters: the helper reads the first "code" as the pairing code. */
export function helperPairMessage(code: string, watch: HelperWatch): string {
  return JSON.stringify({ t: 'pair', code, watch });
}

export function helperResumeMessage(token: string): string {
  return JSON.stringify({ t: 'resume', token });
}

export function helperWatchMessage(watch: HelperWatch): string {
  return JSON.stringify({ t: 'watch', watch });
}

export function helperForgetMessage(): string {
  return JSON.stringify({ t: 'forget' });
}

const STORAGE_KEY = 'rn.helper';

export interface StoredHelper {
  token: string;
  watch: HelperWatch;
}

/** The browser keeps this for the page origin only. The helper stores the hash, not this token. */
export function readHelperDevice(getItem: (key: string) => string | null): StoredHelper | null {
  let raw: unknown;
  try { raw = JSON.parse(getItem(STORAGE_KEY) || 'null'); } catch { return null; }
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as { token?: unknown; watch?: unknown };
  if (typeof row.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(row.token)) return null;
  const watch = watchFrom(row.watch);
  if (!watch) return null;
  return { token: row.token, watch };
}

export function writeHelperDevice(setItem: (key: string, value: string) => void, device: StoredHelper): void {
  setItem(STORAGE_KEY, JSON.stringify({ token: device.token, watch: device.watch }));
}

export function forgetHelperDevice(removeItem: (key: string) => void): void {
  removeItem(STORAGE_KEY);
}

function watchFrom(value: unknown): HelperWatch | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as { kind?: unknown; code?: unknown; button?: unknown };
  if (row.kind === 'key' && typeof row.code === 'string' && row.code.length > 0 && row.code.length < 32) {
    return { kind: 'key', code: row.code };
  }
  if (row.kind === 'mouse' && (row.button === 4 || row.button === 5)) return { kind: 'mouse', button: row.button };
  return null;
}

export type HelperEvent =
  | { t: 'ok'; token: string | null }
  | { t: 'down' }
  | { t: 'up' }
  | { t: 'denied' };

export function parseHelperEvent(text: string): HelperEvent | null {
  let row: unknown;
  try { row = JSON.parse(text); } catch { return null; }
  if (!row || typeof row !== 'object' || !('t' in row)) return null;
  const kind = (row as { t: unknown }).t;
  if (kind === 'down') return { t: 'down' };
  if (kind === 'up') return { t: 'up' };
  if (kind === 'denied') return { t: 'denied' };
  if (kind === 'ok') {
    const token = (row as { token?: unknown }).token;
    const kept = typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
    return { t: 'ok', token: kept };
  }
  return null;
}
