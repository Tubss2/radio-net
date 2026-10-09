import type { RadioNetBridge } from '../../preload';
import type { Keybinds } from '../../shared/types';

/** window.radionet in Electron; a browser fallback (localStorage + no global hotkeys) for UI dev. */
declare global { interface Window { radionet?: RadioNetBridge } }

const fallbackBinds: Keybinds = { ptt: { kind: 'key', keycode: 0, label: 'Space (window only)' }, cycle: null, overlay: null, direct: {} };

export const bridge: RadioNetBridge = window.radionet ?? {
  getToken: async () => localStorage.getItem('rn.token'),
  setToken: async (t: string) => localStorage.setItem('rn.token', t),
  setKeybinds: async () => undefined,
  defaultKeybinds: async () => fallbackBinds,
  recordBind: () => new Promise(() => undefined),
  onHotkey: () => () => undefined,
  setOverlay: () => undefined,
  onOverlay: () => () => undefined,
};
export const inElectron = Boolean(window.radionet);
