/** Local tray helper. It watches one key and sends press and release. It does not see the microphone. */
export const HELPER_URL = 'ws://127.0.0.1:47321';

export const HELPER_FALLBACK =
  'The helper is not running, or this browser blocked the localhost link. Use the phone button, or the desktop app, for in-game push-to-talk.';

export type HelperWatch =
  | { kind: 'key'; code: string }
  | { kind: 'mouse'; button: 4 | 5 };

/** Field order matters: the helper reads the first "code" as the pairing code. */
export function helperPairMessage(code: string, watch: HelperWatch): string {
  return JSON.stringify({ t: 'pair', code, watch });
}

export function parseHelperEvent(text: string): 'ok' | 'down' | 'up' | null {
  let row: unknown;
  try { row = JSON.parse(text); } catch { return null; }
  if (!row || typeof row !== 'object' || !('t' in row)) return null;
  const kind = (row as { t: unknown }).t;
  if (kind === 'ok' || kind === 'down' || kind === 'up') return kind;
  return null;
}
