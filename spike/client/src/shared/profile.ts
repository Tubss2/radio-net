import { clampSoundVolume, DEFAULT_SOUND_VOLUME } from './sounds';
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
  /**
   * Browser only. When true, the admin key may be written to localStorage.
   * The session token is never written there. See browserStore.ts.
   */
  rememberAdmin?: boolean;
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
  /** Short UI cues, including the squelch when a channel is tuned. */
  soundsOn: boolean;
  /** Master level for those cues, 0 to 1. */
  soundVolume: number;
  radios: Record<string, RadioPrefs>;
}

export function emptyProfile(): Profile {
  return { callsign: '', servers: [], keybinds: null, overlayOn: true, soundsOn: true, soundVolume: DEFAULT_SOUND_VOLUME, radios: {} };
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
    soundsOn: p.soundsOn !== false,
    soundVolume: clampSoundVolume(p.soundVolume),
    radios: p.radios && typeof p.radios === 'object' ? p.radios : {},
  };
}
