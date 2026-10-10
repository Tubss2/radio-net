import { contextBridge, ipcRenderer } from 'electron';
import type { Profile } from '../shared/profile';
import type { Bind, HotkeyEvent, Keybinds, OverlayState, UpdateReady, WheelInput } from '../shared/types';
import type { UpdateCheckState } from '../shared/updates';

const api = {
  getProfile: (): Promise<Profile> => ipcRenderer.invoke('profile:get'),
  setProfile: (p: Profile): Promise<void> => ipcRenderer.invoke('profile:set', p),
  setKeybinds: (b: Keybinds): Promise<void> => ipcRenderer.invoke('hotkeys:set', b),
  defaultKeybinds: (): Promise<Keybinds> => ipcRenderer.invoke('hotkeys:defaults'),
  recordBind: (): Promise<Bind | null> => ipcRenderer.invoke('hotkeys:record'),
  setHotkeysEnabled: (enabled: boolean): Promise<void> => ipcRenderer.invoke('hotkeys:setEnabled', enabled),
  onHotkey: (cb: (e: HotkeyEvent) => void) => {
    const h = (_: unknown, e: HotkeyEvent) => cb(e);
    ipcRenderer.on('hotkey', h);
    return (): void => { ipcRenderer.removeListener('hotkey', h); };
  },
  setOverlay: (s: OverlayState) => ipcRenderer.send('overlay:state', s),
  onOverlay: (cb: (s: OverlayState) => void): (() => void) => {
    const h = (_: unknown, s: OverlayState) => cb(s);
    ipcRenderer.on('overlay:state', h);
    return () => { ipcRenderer.removeListener('overlay:state', h); };
  },
  /** Overlay only: true lets clicks fall through to the game. */
  setIgnoreMouse: (ignore: boolean) => ipcRenderer.send('overlay:ignore-mouse', ignore),
  /** Overlay only: a hover, click, scroll or add from the wheel page. */
  sendWheelInput: (input: WheelInput) => ipcRenderer.send('wheel:input', input),
  /** Main window: wheel input forwarded from the overlay page. */
  onWheelInput: (cb: (input: WheelInput) => void): (() => void) => {
    const h = (_: unknown, input: WheelInput) => cb(input);
    ipcRenderer.on('wheel:input', h);
    return () => { ipcRenderer.removeListener('wheel:input', h); };
  },
  onUpdateAvailable: (cb: (info: UpdateReady) => void): (() => void) => {
    const h = (_: unknown, info: UpdateReady) => cb(info);
    ipcRenderer.on('update:available', h);
    return () => { ipcRenderer.removeListener('update:available', h); };
  },
  onUpdateReady: (cb: (info: UpdateReady) => void): (() => void) => {
    const h = (_: unknown, info: UpdateReady) => cb(info);
    ipcRenderer.on('update:ready', h);
    return () => { ipcRenderer.removeListener('update:ready', h); };
  },
  downloadUpdate: () => ipcRenderer.send('update:download'),
  installUpdate: () => ipcRenderer.send('update:install'),
  checkForUpdates: (): Promise<UpdateCheckState> => ipcRenderer.invoke('update:check'),
  showLogs: (): Promise<void> => ipcRenderer.invoke('logs:show'),
  appFacts: (): Promise<{ packaged: boolean; platform: string; arch: string }> => ipcRenderer.invoke('app:facts'),
  log: (event: string, detail?: string) => ipcRenderer.send('log:event', event, detail),
  /** Compact the main window. The radio stays in this window so there is one microphone. */
  setSimpleWindow: (state: { compact: boolean; alwaysOnTop: boolean }) => ipcRenderer.send('window:simple', state),
};
export type RadioNetBridge = typeof api;
contextBridge.exposeInMainWorld('radionet', api);
