import { join } from 'node:path';
import { BrowserWindow, app, ipcMain, safeStorage, screen, session } from 'electron';
import { withBindDefaults } from '../shared/keybinds';
import { emptyProfile, normaliseProfile, type Profile } from '../shared/profile';
import type { HotkeyEvent, Keybinds, OverlayState, WheelInput } from '../shared/types';
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

/** Corner box the talker list lives in. The channel wheel temporarily replaces this with the full display. */
function overlayCorner() {
  const { workArea } = screen.getPrimaryDisplay();
  return { x: workArea.x + 24, y: workArea.y + 24, width: 360, height: 220 };
}

/** Transparent, click-through, always-on-top window. Nothing is injected into the game.
 *  Talker rows stay in the corner and never take focus. The channel wheel expands this window and focuses it briefly. */
function createOverlay() {
  const corner = overlayCorner();
  overlay = new BrowserWindow({
    ...corner,
    transparent: true, frame: false, resizable: false, movable: false, focusable: false,
    skipTaskbar: true, alwaysOnTop: true, hasShadow: false, show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: false },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setIgnoreMouseEvents(true);
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  page('overlay', overlay);
}

// --- local profile: callsign, server history, keybinds, radio prefs. Encrypted with the OS when it can (DPAPI on Windows). ---
const profileFile = () => join(app.getPath('userData'), 'profile.bin');
function readProfile(): Profile {
  try {
    if (!existsSync(profileFile())) return emptyProfile();
    const buf = readFileSync(profileFile());
    const text = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8');
    return normaliseProfile(JSON.parse(text));
  } catch {
    return emptyProfile();
  }
}
function writeProfile(p: Profile) {
  const text = JSON.stringify(p);
  const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text) : Buffer.from(text, 'utf8');
  writeFileSync(profileFile(), data, { mode: 0o600 });
}
ipcMain.handle('profile:get', () => readProfile());
ipcMain.handle('profile:set', (_e, p: Profile) => writeProfile(normaliseProfile(p)));

let wheelShown = false;

/** Drop scroll, digit and Esc events while the wheel window is focused so the page and the hook don't both apply them. G still always comes through. */
const hotkeys = new Hotkeys((e: HotkeyEvent) => {
  if (overlay?.isFocused() && (e.type === 'wheel-scroll' || e.type === 'wheel-number' || e.type === 'wheel-cancel')) return;
  main?.webContents.send('hotkey', e);
});
ipcMain.handle('hotkeys:set', (_e, b: Keybinds) => hotkeys.setBinds(b));
ipcMain.handle('hotkeys:defaults', () => DEFAULT_BINDS);
ipcMain.handle('hotkeys:record', () => hotkeys.record());

ipcMain.on('overlay:state', (_e, s: OverlayState) => {
  if (!overlay) return;
  const want = Boolean(s.wheel?.open);
  if (want && !wheelShown) {
    // The wheel takes focus for this moment so hover and clicks land on a segment.
    wheelShown = true;
    overlay.setBounds(screen.getPrimaryDisplay().bounds);
    overlay.setFocusable(true);
    overlay.setIgnoreMouseEvents(true, { forward: true });
    overlay.show();
    overlay.focus();
  } else if (!want && wheelShown) {
    wheelShown = false;
    const corner = overlayCorner();
    overlay.setFocusable(false);
    overlay.setIgnoreMouseEvents(true);
    overlay.setBounds(corner);
    overlay.blur();
    if (s.visible) overlay.showInactive(); else overlay.hide();
  } else if (!want) {
    if (s.visible) overlay.showInactive(); else overlay.hide();
  }
  overlay.webContents.send('overlay:state', s);
});

/** While the pointer is over the ring (or the add field is open) the wheel window accepts clicks. Elsewhere they pass through to the game. */
ipcMain.on('overlay:ignore-mouse', (_e, ignore: boolean) => {
  if (!overlay || !wheelShown) return;
  if (ignore) overlay.setIgnoreMouseEvents(true, { forward: true });
  else overlay.setIgnoreMouseEvents(false);
});

ipcMain.on('wheel:input', (_e, input: WheelInput) => {
  main?.webContents.send('wheel:input', input);
});

app.whenReady().then(() => {
  // Only allow the microphone; deny every other permission request.
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'media'));
  createMain();
  createOverlay();
  hotkeys.setBinds(withBindDefaults(readProfile().keybinds ?? DEFAULT_BINDS));
  try { hotkeys.start(); } catch (err) { console.error('global hotkeys unavailable', err); }
});
app.on('window-all-closed', () => { hotkeys.stop(); app.quit(); });
