import type { RadioNetBridge } from '../../preload';
import type { Keybinds, OverlayState, WheelInput } from '../../shared/types';
import { emitPreviewWheel, onPreviewHotkey, onPreviewOverlay, onPreviewWheel, publishOverlay } from './lib/previewBus';
import { isPreview } from './lib/previewMode';

/** window.radionet in Electron; a browser fallback (localStorage + no global hotkeys) for UI dev. */
declare global { interface Window { radionet?: RadioNetBridge } }

const fallbackBinds: Keybinds = {
  ptt: { kind: 'key', keycode: 0, label: 'Space (window only)' },
  cycle: null,
  overlay: null,
  wheel: { kind: 'key', keycode: 34, label: 'G' },
  direct: {},
};

const previewBinds: Keybinds = {
  ptt: { kind: 'key', keycode: 0, label: 'Space' },
  cycle: null,
  overlay: { kind: 'key', keycode: 0, label: 'F10' },
  wheel: { kind: 'key', keycode: 34, label: 'G' },
  direct: {},
};

/** In-page stand-in for the Electron preload, used only by `npm run preview`. */
function previewBridge(): RadioNetBridge {
  return {
    getToken: async () => 'preview',
    setToken: async () => undefined,
    setKeybinds: async () => undefined,
    defaultKeybinds: async () => previewBinds,
    recordBind: () => new Promise(() => undefined),
    onHotkey: (cb) => onPreviewHotkey(cb),
    setOverlay: (s: OverlayState) => publishOverlay(s),
    onOverlay: (cb) => onPreviewOverlay(cb),
    setIgnoreMouse: () => undefined,
    sendWheelInput: (input: WheelInput) => emitPreviewWheel(input),
    onWheelInput: (cb) => onPreviewWheel(cb),
  };
}

const browserFallback: RadioNetBridge = {
  getToken: async () => localStorage.getItem('rn.token'),
  setToken: async (t: string) => localStorage.setItem('rn.token', t),
  setKeybinds: async () => undefined,
  defaultKeybinds: async () => fallbackBinds,
  recordBind: () => new Promise(() => undefined),
  onHotkey: () => () => undefined,
  setOverlay: () => undefined,
  onOverlay: () => () => undefined,
  setIgnoreMouse: () => undefined,
  sendWheelInput: () => undefined,
  onWheelInput: () => () => undefined,
};

export const bridge: RadioNetBridge = window.radionet ?? (isPreview ? previewBridge() : browserFallback);
export const inElectron = Boolean(window.radionet);
