import type { RadioNetBridge } from '../../preload';
import { browserDiskNeedsScrub, profileForDisk, profileWithSessions, sessionsFromProfile } from '../../shared/browserProfile';
import { pageKeybinds } from '../../shared/keybinds';
import { emptyProfile, normaliseProfile, type Profile } from '../../shared/profile';
import type { Bind, Keybinds, OverlayState, WheelInput } from '../../shared/types';
import type { UpdateCheckState } from '../../shared/updates';
import { emitPreviewWheel, onPreviewHotkey, onPreviewOverlay, onPreviewUpdate, onPreviewWheel, publishOverlay } from './lib/previewBus';
import { isPreview } from './lib/previewMode';

/** window.radionet in Electron; a browser fallback (localStorage + in-page keys) for UI dev. */
declare global { interface Window { radionet?: RadioNetBridge } }

const PROFILE_KEY = 'rn.profile';
const SESSION_KEY = 'rn.sessions';
const webBuild = import.meta.env.MODE === 'web';

const fallbackBinds: Keybinds = pageKeybinds(null, false);
const previewBinds: Keybinds = pageKeybinds(null, true);

let capturing = false;
export function isCapturingBind() { return capturing; }

function domKeycode(e: KeyboardEvent): number {
  if (e.code === 'KeyG') return 34;
  if (e.code === 'Escape') return 1;
  if (e.code === 'F1') return 59;
  if (e.code === 'F2') return 60;
  if (e.code === 'F3') return 61;
  if (e.code === 'F4') return 62;
  if (e.code === 'F5') return 63;
  if (e.code === 'F10') return 68;
  let n = 0;
  for (const ch of e.code) n = (n * 33 + ch.charCodeAt(0)) % 40000;
  return 1000 + n;
}

function domKeyLabel(e: KeyboardEvent): string {
  if (e.code.startsWith('Key') && e.code.length === 4) return e.code.slice(3);
  if (e.code.startsWith('Digit')) return e.code.slice(5);
  if (/^F\d{1,2}$/.test(e.code)) return e.code;
  return e.key.length === 1 ? e.key.toUpperCase() : e.code;
}

/** Match a saved key bind against a DOM keyboard event. Mouse binds are global only inside Electron. */
export function domEventMatchesBind(e: KeyboardEvent, b: Bind | null): boolean {
  if (!b || b.kind !== 'key') return false;
  if (b.keycode === 34 && e.code === 'KeyG') return true;
  if (b.keycode === 68 && e.code === 'F10') return true;
  if (/^[A-Z0-9]$/.test(b.label) && (e.code === `Key${b.label}` || e.code === `Digit${b.label}`)) return true;
  if (/^F\d{1,2}$/.test(b.label) && e.code === b.label) return true;
  return false;
}

/** Click a slot, then press a key or a side mouse button. Escape cancels. Left/right/middle are ignored. */
export function captureBind(): Promise<Bind | null> {
  capturing = true;
  return new Promise((resolve) => {
    const finish = (b: Bind | null) => {
      capturing = false;
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onMouse, true);
      resolve(b);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { finish(null); return; }
      finish({ kind: 'key', keycode: domKeycode(e), label: domKeyLabel(e) });
    };
    const onMouse = (e: MouseEvent) => {
      const button = e.button + 1; // DOM is 0-based; the global hook is 1-based.
      if (button <= 2) return;
      e.preventDefault();
      e.stopPropagation();
      finish({ kind: 'mouse', button, label: `Mouse ${button}` });
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
  });
}

function readSessions(): Record<string, { token?: string; tokenExp?: number }> {
  try {
    const value = JSON.parse(sessionStorage.getItem(SESSION_KEY) || '{}') as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, { token?: string; tokenExp?: number }>;
  } catch {
    return {};
  }
}

function readLocalProfile(): Profile {
  let raw: unknown = null;
  try { raw = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null'); } catch { raw = null; }
  const profile = normaliseProfile(raw);
  if (!webBuild) return profile;
  const merged = profileWithSessions(profile, readSessions());
  if (browserDiskNeedsScrub(raw)) localStorage.setItem(PROFILE_KEY, JSON.stringify(profileForDisk(merged)));
  return merged;
}

function writeLocalProfile(p: Profile) {
  if (webBuild) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessionsFromProfile(p)));
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profileForDisk(p)));
    return;
  }
  localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
}

function previewBridge(): RadioNetBridge {
  return {
    getProfile: async () => readLocalProfile(),
    setProfile: async (p) => { writeLocalProfile(p); },
    setKeybinds: async () => undefined,
    defaultKeybinds: async () => previewBinds,
    recordBind: () => captureBind(),
    setHotkeysEnabled: async () => undefined,
    onHotkey: (cb) => onPreviewHotkey(cb),
    setOverlay: (s: OverlayState) => publishOverlay(s),
    onOverlay: (cb) => onPreviewOverlay(cb),
    setIgnoreMouse: () => undefined,
    sendWheelInput: (input: WheelInput) => emitPreviewWheel(input),
    onWheelInput: (cb) => onPreviewWheel(cb),
    onUpdateAvailable: () => () => undefined,
    onUpdateReady: (cb) => onPreviewUpdate(cb),
    downloadUpdate: () => undefined,
    installUpdate: () => { document.documentElement.dataset.updateInstall = '1'; },
    checkForUpdates: async (): Promise<UpdateCheckState> => ({ state: 'dev' }),
    showLogs: async () => undefined,
    appFacts: async () => ({ packaged: false, platform: 'preview', arch: '' }),
    log: () => undefined,
    setSimpleWindow: () => undefined,
  };
}

const browserFallback: RadioNetBridge = {
  getProfile: async () => readLocalProfile(),
  setProfile: async (p) => { writeLocalProfile(p); },
  setKeybinds: async () => undefined,
  defaultKeybinds: async () => fallbackBinds,
  recordBind: () => captureBind(),
  setHotkeysEnabled: async () => undefined,
  onHotkey: () => () => undefined,
  setOverlay: () => undefined,
  onOverlay: () => () => undefined,
  setIgnoreMouse: () => undefined,
  sendWheelInput: () => undefined,
  onWheelInput: () => () => undefined,
  onUpdateAvailable: () => () => undefined,
  onUpdateReady: () => () => undefined,
  downloadUpdate: () => undefined,
  installUpdate: () => undefined,
  checkForUpdates: async (): Promise<UpdateCheckState> => ({ state: 'dev' }),
  showLogs: async () => undefined,
  appFacts: async () => ({ packaged: false, platform: 'browser', arch: '' }),
  log: () => undefined,
  setSimpleWindow: () => undefined,
};

export const bridge: RadioNetBridge = window.radionet ?? (isPreview ? previewBridge() : browserFallback);
export const inElectron = Boolean(window.radionet);
