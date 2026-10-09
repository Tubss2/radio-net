import { contextBridge, ipcRenderer } from 'electron';
import type { Bind, HotkeyEvent, Keybinds, OverlayState } from '../shared/types';

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
};
export type RadioNetBridge = typeof api;
contextBridge.exposeInMainWorld('radionet', api);
