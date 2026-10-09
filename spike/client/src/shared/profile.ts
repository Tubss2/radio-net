import type { Keybinds } from './types';

/** A community this PC has joined. The admin key is present only if this PC created it or imported one. */
export interface ServerEntry {
  id: string;
  name: string;
  url: string;
  inviteCode: string;
  adminKey?: string;
  lastUsed: string;
  /** Short-lived join session. Refreshed by joining again with the invite code and callsign. */
  token?: string;
  tokenExp?: number;
}

export interface RadioPrefs {
  tuned: string[];
  tx: string | null;
  volume: Record<string, number>;
  muted: Record<string, boolean>;
  pan: Record<string, number>;
}

/** Everything that belongs to this PC. The server does not keep a copy. */
export interface Profile {
  callsign: string;
  servers: ServerEntry[];
  keybinds: Keybinds | null;
  overlayOn: boolean;
  radios: Record<string, RadioPrefs>;
}

export function emptyProfile(): Profile {
  return { callsign: '', servers: [], keybinds: null, overlayOn: true, radios: {} };
}

export function emptyRadio(): RadioPrefs {
  return { tuned: [], tx: null, volume: {}, muted: {}, pan: {} };
}

export function normaliseProfile(raw: unknown): Profile {
  const base = emptyProfile();
  if (!raw || typeof raw !== 'object') return base;
  const p = raw as Partial<Profile>;
  return {
    callsign: typeof p.callsign === 'string' ? p.callsign : '',
    servers: Array.isArray(p.servers) ? p.servers.filter((s) => s && typeof s.id === 'string' && typeof s.url === 'string') : [],
    keybinds: p.keybinds ?? null,
    overlayOn: p.overlayOn !== false,
    radios: p.radios && typeof p.radios === 'object' ? p.radios : {},
  };
}
