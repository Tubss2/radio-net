import { clampSoundVolume, DEFAULT_SOUND_VOLUME } from './sounds';
import type { Keybinds } from './types';

/** A community this PC has joined. The admin key is present only if this PC created it or imported one. */
export interface ServerEntry {
  id: string;
  name: string;
  url: string;
  inviteCode: string;
  adminKey?: string;
  /** Web only. The admin key is written to localStorage only when this is true. */
  rememberAdmin?: boolean;
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
  /**
   * Desktop keybind generation. Missing or 0 is a profile from before the F-key defaults.
   * 2 is the unreleased F2-overlay set. 3 is F2 wheel and F5 overlay.
   */
  keybindsVersion?: number;
  overlayOn: boolean;
  /** Static when this radio adds a channel. Older profiles stored this as the only UI-sounds switch. */
  soundsOn: boolean;
  /** Own push-to-talk press and release. Off unless this profile turned it on. */
  soundPtt: boolean;
  /** Tone when the transmit channel changes. */
  soundTx: boolean;
  /** Master level for those cues, 0 to 1. */
  soundVolume: number;
  /** In-page push-to-talk key (`KeyboardEvent.code`). The desktop app uses the global bind. */
  talkKey: string;
  talkMode: 'hold' | 'voice';
  /** 0 is least sensitive, 1 opens on a quiet voice. */
  voiceSensitivity: number;
  voiceReleaseMs: number;
  /** Desktop: the main window is the compact list. */
  simpleOn: boolean;
  simpleOnTop: boolean;
  radios: Record<string, RadioPrefs>;
  /** The first-run explanation has been accepted. The global hook stays off until this is true. */
  privacyAccepted: boolean;
  /** False removes the global hook. Defaults to on once the explanation has been accepted. */
  hotkeysEnabled: boolean;
}

export function emptyProfile(): Profile {
  return {
    callsign: '', servers: [], keybinds: null, keybindsVersion: 0, overlayOn: true,
    soundsOn: true, soundPtt: false, soundTx: true, soundVolume: DEFAULT_SOUND_VOLUME,
    talkKey: 'Space', talkMode: 'hold', voiceSensitivity: 0.45, voiceReleaseMs: 300, simpleOn: false, simpleOnTop: false, radios: {},
    privacyAccepted: false, hotkeysEnabled: true,
  };
}

function clamp01(n: unknown, fallback: number): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : fallback;
  return Math.min(1, Math.max(0, v));
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
  if (s.rememberAdmin === true) entry.rememberAdmin = true;
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
    keybindsVersion: typeof p.keybindsVersion === 'number' && Number.isInteger(p.keybindsVersion) && p.keybindsVersion > 0 && p.keybindsVersion < 100
      ? p.keybindsVersion
      : 0,
    overlayOn: p.overlayOn !== false,
    soundsOn: p.soundsOn !== false,
    soundPtt: p.soundPtt === true,
    soundTx: p.soundTx !== false,
    soundVolume: clampSoundVolume(p.soundVolume),
    talkKey: typeof p.talkKey === 'string' && p.talkKey ? p.talkKey : 'Space',
    talkMode: p.talkMode === 'voice' ? 'voice' : 'hold',
    voiceSensitivity: clamp01(p.voiceSensitivity, 0.45),
    voiceReleaseMs: typeof p.voiceReleaseMs === 'number' && p.voiceReleaseMs >= 50 && p.voiceReleaseMs <= 2000 ? p.voiceReleaseMs : 300,
    simpleOn: p.simpleOn === true,
    simpleOnTop: p.simpleOnTop === true,
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
