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
  /** The first-run explanation has been accepted. The global hook stays off until this is true. */
  privacyAccepted: boolean;
  /** False removes the global hook. Defaults to on once the explanation has been accepted. */
  hotkeysEnabled: boolean;
}

export function emptyProfile(): Profile {
  return {
    callsign: '', servers: [], keybinds: null, overlayOn: true, soundsOn: true,
    soundVolume: DEFAULT_SOUND_VOLUME, radios: {}, privacyAccepted: false, hotkeysEnabled: true,
  };
}

function cleanServer(s: ServerEntry): ServerEntry {
  const entry: ServerEntry = {
    id: s.id.slice(0, 64),
    name: typeof s.name === 'string' ? s.name.slice(0, 64) : '',
    url: s.url.slice(0, 300),
    inviteCode: typeof s.inviteCode === 'string' ? s.inviteCode.slice(0, 64) : '',
    lastUsed: typeof s.lastUsed === 'string' ? s.lastUsed.slice(0, 40) : '',
  };
  if (typeof s.adminKey === 'string' && s.adminKey.length > 0 && s.adminKey.length <= 200) entry.adminKey = s.adminKey;
  if (typeof s.token === 'string' && s.token.length > 0 && s.token.length <= 4000) entry.token = s.token;
  if (typeof s.tokenExp === 'number' && Number.isFinite(s.tokenExp)) entry.tokenExp = s.tokenExp;
  return entry;
}

export function emptyRadio(): RadioPrefs {
  return { tuned: [], tx: null, volume: {}, muted: {}, pan: {} };
}

export function normaliseProfile(raw: unknown): Profile {
  const base = emptyProfile();
  if (!raw || typeof raw !== 'object') return base;
  const p = raw as Partial<Profile>;
  return {
    callsign: typeof p.callsign === 'string' ? p.callsign.slice(0, 64) : '',
    servers: Array.isArray(p.servers)
      ? p.servers.filter((s) => s && typeof s.id === 'string' && typeof s.url === 'string').slice(0, 50).map(cleanServer)
      : [],
    keybinds: p.keybinds ?? null,
    overlayOn: p.overlayOn !== false,
    soundsOn: p.soundsOn !== false,
    soundVolume: clampSoundVolume(p.soundVolume),
    radios: p.radios && typeof p.radios === 'object' ? p.radios : {},
    privacyAccepted: p.privacyAccepted === true,
    hotkeysEnabled: p.hotkeysEnabled !== false,
  };
}

/**
 * Admin key and session token stay in the file only when the OS can encrypt it.
 * Without DPAPI (or the Linux equivalent) they are kept in memory for this run and dropped on save.
 */
export function persistableProfile(p: Profile, opts: { encrypt: boolean }): Profile {
  const clean = normaliseProfile(p);
  if (opts.encrypt) return clean;
  return {
    ...clean,
    servers: clean.servers.map(({ adminKey: _admin, token: _token, tokenExp: _exp, ...rest }) => rest),
  };
}
