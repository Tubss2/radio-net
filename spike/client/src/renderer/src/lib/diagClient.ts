const KEY = 'rn-diag-client';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Random id for this tab. It is not a callsign and it is not stored on the server as an account. */
export function diagClientId(): string {
  try {
    const current = sessionStorage.getItem(KEY);
    if (current && UUID.test(current)) return current;
    const next = crypto.randomUUID();
    sessionStorage.setItem(KEY, next);
    return next;
  } catch {
    return '00000000-0000-4000-8000-000000000000';
  }
}

export const VOICE_DIAG_AUTO = 'rn-voice-diag-auto';
