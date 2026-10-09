import { contextBridge, ipcRenderer } from 'electron';
import type { Bind, HotkeyEvent, Keybinds, OverlayState, WheelInput } from '../shared/types';

const api = {
  getToken: (): Promise<string | null> => ipcRenderer.invoke('token:get'),
  setToken: (t: string): Promise<void> => ipcRenderer.invoke('token:set', t),
  setKeybinds: (b: Keybinds): Promise<void> => ipcRenderer.invoke('hotkeys:set', b),
  defaultKeybinds: (): Promise<Keybinds> => ipcRenderer.invoke('hotkeys:defaults'),
  recordBind: (): Promise<Bind> => ipcRenderer.invoke('hotkeys:record'),
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
};
export type RadioNetBridge = typeof api;
contextBridge.exposeInMainWorld('radionet', api);
