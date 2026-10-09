import { join } from 'node:path';
import { BrowserWindow, app, ipcMain, safeStorage, screen, session } from 'electron';
import type { HotkeyEvent, Keybinds, OverlayState } from '../shared/types';
import { DEFAULT_BINDS, Hotkeys } from './hotkeys';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

// Test-only: fake microphone (a beep) so the app can be exercised headlessly. Never set in release builds.
if (process.env.RN_FAKE_MEDIA === '1') {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
}

// Separate profile (tests, or running two clients on one PC).
if (process.env.RN_USER_DATA) app.setPath('userData', process.env.RN_USER_DATA);

let main: BrowserWindow | null = null;
let overlay: BrowserWindow | null = null;
const rendererUrl = process.env.ELECTRON_RENDERER_URL;
const page = (name: string, w: BrowserWindow) =>
  rendererUrl ? w.loadURL(`${rendererUrl}/${name}.html`) : w.loadFile(join(__dirname, `../renderer/${name}.html`));

function createMain() {
  main = new BrowserWindow({
    width: 1120, height: 760, minWidth: 880, minHeight: 600,
    backgroundColor: '#0e1014', title: 'Radio Net', show: false,
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#0e1014', symbolColor: '#9aa3b2', height: 36 },
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: false, backgroundThrottling: false },
  });
  main.once('ready-to-show', () => main?.show());
  page('index', main);
}

/** Separate transparent, click-through, never-focused window on top of the game. Nothing is injected into the game. */
function createOverlay() {
  const { workArea } = screen.getPrimaryDisplay();
  overlay = new BrowserWindow({
    x: workArea.x + 24, y: workArea.y + 24, width: 360, height: 220,
    transparent: true, frame: false, resizable: false, movable: false, focusable: false,
    skipTaskbar: true, alwaysOnTop: true, hasShadow: false, show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: false },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setIgnoreMouseEvents(true);
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  page('overlay', overlay);
}

// --- device token: encrypted with the OS (DPAPI on Windows) via safeStorage ---
const tokenFile = () => join(app.getPath('userData'), 'device-token.bin');
ipcMain.handle('token:get', () => {
  if (!existsSync(tokenFile())) return null;
  const buf = readFileSync(tokenFile());
  return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8');
});
ipcMain.handle('token:set', (_e, token: string) => {
  const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(token) : Buffer.from(token, 'utf8');
  writeFileSync(tokenFile(), data, { mode: 0o600 });
});

const hotkeys = new Hotkeys((e: HotkeyEvent) => main?.webContents.send('hotkey', e));
ipcMain.handle('hotkeys:set', (_e, b: Keybinds) => hotkeys.setBinds(b));
ipcMain.handle('hotkeys:defaults', () => DEFAULT_BINDS);
ipcMain.handle('hotkeys:record', () => hotkeys.record());

ipcMain.on('overlay:state', (_e, s: OverlayState) => {
  if (!overlay) return;
  if (s.visible) overlay.showInactive(); else overlay.hide();
  overlay.webContents.send('overlay:state', s);
});

app.whenReady().then(() => {
  // Only allow the microphone; deny every other permission request.
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'media'));
  createMain();
  createOverlay();
  hotkeys.setBinds(DEFAULT_BINDS);
  try { hotkeys.start(); } catch (err) { console.error('global hotkeys unavailable', err); }
});
app.on('window-all-closed', () => { hotkeys.stop(); app.quit(); });
