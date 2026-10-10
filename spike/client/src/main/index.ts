import { join } from 'node:path';
import { BrowserWindow, app, ipcMain, safeStorage, screen, session, shell, type WebContents } from 'electron';
import { parseKeybinds, parseLogEvent, parseOverlayState, parseWheelInput } from '../shared/ipcValidate';
import { migrateDesktopKeybinds, withBindDefaults } from '../shared/keybinds';
import { duplicateWheelNotch, hookScrollReachesPage, type WheelNotch } from '../shared/radialWheel';
import { emptyProfile, normaliseProfile, persistableProfile, type Profile } from '../shared/profile';
import { isAllowedAppUrl, mediaTypesOf, RENDERER_CSP, rendererWebPreferences, shouldAllowMedia } from '../shared/windowPolicy';
import type { HotkeyEvent } from '../shared/types';
import { clientLog } from './clientLog';
import { DEFAULT_BINDS, Hotkeys } from './hotkeys';
import { checkForUpdatesNow, downloadAvailableUpdate, installDownloadedUpdate, startUpdater } from './updater';
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

const preloadPath = () => join(__dirname, '../preload/index.js');

function guardWindow(win: BrowserWindow) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const stop = (event: Electron.Event, url: string) => {
    if (!isAllowedAppUrl(url, rendererUrl)) event.preventDefault();
  };
  win.webContents.on('will-navigate', stop);
  win.webContents.on('will-redirect', stop);
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
}

function fromApp(sender: WebContents): boolean {
  return isAllowedAppUrl(sender.getURL(), rendererUrl);
}

function createMain() {
  main = new BrowserWindow({
    width: 1120, height: 760, minWidth: 880, minHeight: 600,
    backgroundColor: '#0e1014', title: 'Radio Net', show: false,
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#0e1014', symbolColor: '#9aa3b2', height: 36 },
    webPreferences: rendererWebPreferences(preloadPath(), { backgroundThrottling: false }),
  });
  guardWindow(main);
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
    webPreferences: rendererWebPreferences(preloadPath()),
  });
  guardWindow(overlay);
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
    const profile = normaliseProfile(JSON.parse(text));
    const migrated = migrateDesktopKeybinds(profile.keybinds, profile.keybindsVersion);
    if (!migrated.changed) return profile;
    const next = { ...profile, keybinds: migrated.keybinds, keybindsVersion: migrated.version };
    writeProfile(next);
    return next;
  } catch {
    return emptyProfile();
  }
}
let warnedPlaintext = false;
function writeProfile(p: Profile) {
  const encrypt = safeStorage.isEncryptionAvailable();
  const text = JSON.stringify(persistableProfile(p, { encrypt }));
  const data = encrypt ? safeStorage.encryptString(text) : Buffer.from(text, 'utf8');
  writeFileSync(profileFile(), data, { mode: 0o600 });
  if (!encrypt && !warnedPlaintext) {
    warnedPlaintext = true;
    clientLog('profile', 'OS encryption unavailable; admin key and session were not written');
  }
}
ipcMain.handle('profile:get', (e) => (fromApp(e.sender) ? readProfile() : emptyProfile()));
ipcMain.handle('profile:set', (e, p: unknown) => { if (fromApp(e.sender)) writeProfile(normaliseProfile(p)); });

let wheelShown = false;
/** True while the wheel window is letting mouse input pass through to the game. forward does not include the wheel. */
let wheelIgnoresMouse = true;
let recentWheel: WheelNotch | null = null;

/**
 * Show the channel wheel on the full display and take focus.
 *
 * The overlay is created focusable:false so talker rows never steal the game.
 * On Windows, setFocusable(true) does not stick until the window is hidden and
 * shown again, and showInactive() never becomes the foreground window. The mouse
 * wheel (WM_MOUSEWHEEL) goes to that foreground window, so a ring that only
 * called focus() on a still-unfocusable window ignored scroll until a click
 * activated it. Click-through (setIgnoreMouseEvents true) also drops the wheel;
 * `forward` only delivers mousemove. The ring therefore accepts the mouse as it
 * appears, and a later pointer move outside the ring turns click-through back on.
 *
 * Taking focus pulls the keyboard off the game for as long as the wheel is open.
 * Closing blurs the overlay and shows the talker box with showInactive(), so the
 * game can be foreground again. If the game is exclusive fullscreen and will not
 * give up focus, the global hook still applies the notch (see hotkeys.ts). The
 * hook does not swallow input, so a game that kept focus scrolls as well.
 */
function presentWheelOverlay(win: BrowserWindow) {
  // Hide first when the talker box is already showing. setFocusable(true) on a
  // window that was created focusable:false does not take effect until the next show.
  if (win.isVisible()) win.hide();
  win.setFocusable(true);
  win.setBounds(screen.getPrimaryDisplay().bounds);
  wheelIgnoresMouse = false;
  win.setIgnoreMouseEvents(false);
  win.show();
  win.moveTop();
  win.focus();
  win.webContents.focus();
}

function dismissWheelOverlay(win: BrowserWindow, talkersVisible: boolean) {
  wheelIgnoresMouse = true;
  win.setFocusable(false);
  win.setIgnoreMouseEvents(true);
  win.setBounds(overlayCorner());
  win.blur();
  if (talkersVisible) win.showInactive();
  else win.hide();
}

/** Long enough for the overlay page to claim a notch the hook already saw. */
const HOOK_SCROLL_HOLD_MS = 40;
const pendingHookScrolls = new Set<ReturnType<typeof setTimeout>>();

function cancelPendingHookScrolls() {
  for (const timer of pendingHookScrolls) clearTimeout(timer);
  pendingHookScrolls.clear();
}

/**
 * Digits and Esc while the wheel window is focused belong to the page.
 * Scroll from the hook is applied immediately when the page cannot see the wheel
 * (not focused, or click-through). When the page can see it, the hook waits briefly
 * so a hit-tested segment wins; if the cursor is off the ring the page stays quiet
 * and the hook then moves the hovered segment, or the transmit segment.
 */
const hotkeys = new Hotkeys((e: HotkeyEvent) => {
  if ((e.type === 'wheel-number' || e.type === 'wheel-cancel') && overlay?.isFocused()) return;
  if (e.type === 'wheel-scroll') {
    const notch: WheelNotch = { at: Date.now(), steps: e.steps, shift: e.shift, source: 'hook' };
    if (duplicateWheelNotch(recentWheel, notch)) return;
    const send = () => {
      if (duplicateWheelNotch(recentWheel, notch)) return;
      recentWheel = { ...notch, at: Date.now() };
      main?.webContents.send('hotkey', e);
    };
    const pageGetsIt = hookScrollReachesPage({
      focused: Boolean(overlay?.isFocused()),
      ignoringMouse: wheelIgnoresMouse,
    });
    if (!pageGetsIt) { send(); return; }
    const timer = setTimeout(() => { pendingHookScrolls.delete(timer); send(); }, HOOK_SCROLL_HOLD_MS);
    pendingHookScrolls.add(timer);
    return;
  }
  main?.webContents.send('hotkey', e);
});
ipcMain.handle('hotkeys:set', (e, b: unknown) => {
  if (!fromApp(e.sender)) return;
  const parsed = parseKeybinds(b);
  if (parsed) hotkeys.setBinds(parsed);
});
ipcMain.handle('hotkeys:defaults', (e) => (fromApp(e.sender) ? DEFAULT_BINDS : DEFAULT_BINDS));
ipcMain.handle('hotkeys:record', (e) => (fromApp(e.sender) ? hotkeys.record() : null));
ipcMain.handle('hotkeys:setEnabled', (e, enabled: unknown) => {
  if (!fromApp(e.sender) || typeof enabled !== 'boolean') return;
  if (enabled) {
    try { hotkeys.start(); } catch { clientLog('hotkeys', 'start failed'); }
  } else {
    hotkeys.stop();
  }
});

ipcMain.on('overlay:state', (e, raw: unknown) => {
  if (!fromApp(e.sender) || !overlay) return;
  const s = parseOverlayState(raw);
  if (!s) return;
  const want = Boolean(s.wheel?.open);
  if (want && !wheelShown) {
    wheelShown = true;
    hotkeys.setWheelOpen(true);
    presentWheelOverlay(overlay);
  } else if (!want && wheelShown) {
    wheelShown = false;
    hotkeys.setWheelOpen(false);
    cancelPendingHookScrolls();
    dismissWheelOverlay(overlay, s.visible);
  } else if (!want) {
    if (s.visible) overlay.showInactive(); else overlay.hide();
  }
  overlay.webContents.send('overlay:state', s);
});

/** While the pointer is over the ring (or the add field is open) the wheel window accepts clicks. Elsewhere they pass through to the game. */
ipcMain.on('overlay:ignore-mouse', (e, ignore: unknown) => {
  if (!fromApp(e.sender) || !overlay || !wheelShown || typeof ignore !== 'boolean') return;
  wheelIgnoresMouse = ignore;
  if (ignore) overlay.setIgnoreMouseEvents(true, { forward: true });
  else overlay.setIgnoreMouseEvents(false);
});

ipcMain.on('wheel:input', (e, raw: unknown) => {
  if (!fromApp(e.sender)) return;
  const input = parseWheelInput(raw);
  if (!input) return;
  if (input.type === 'scroll') {
    const notch: WheelNotch = { at: Date.now(), steps: input.steps, shift: input.shift, source: 'page' };
    if (duplicateWheelNotch(recentWheel, notch)) return;
    recentWheel = notch;
  }
  main?.webContents.send('wheel:input', input);
});

/** Simple mode is this same window, resized. A second window would open a second microphone. */
ipcMain.on('window:simple', (e, payload: unknown) => {
  if (!main || !fromApp(e.sender) || e.sender !== main.webContents || !payload || typeof payload !== 'object') return;
  const body = payload as { compact?: unknown; alwaysOnTop?: unknown };
  const compact = body.compact === true;
  const onTop = body.alwaysOnTop === true;
  if (compact) {
    main.setMinimumSize(360, 480);
    const [w] = main.getSize();
    if (w > 520) main.setSize(420, 640);
    main.setAlwaysOnTop(onTop, 'floating');
    return;
  }
  main.setAlwaysOnTop(false);
  main.setMinimumSize(880, 600);
  const [w, h] = main.getSize();
  if (w < 880 || h < 600) main.setSize(1120, 760);
});

ipcMain.on('update:install', (e) => { if (fromApp(e.sender)) installDownloadedUpdate(); });
ipcMain.on('update:download', (e) => { if (fromApp(e.sender)) downloadAvailableUpdate(); });
ipcMain.handle('update:check', (e) => (fromApp(e.sender) ? checkForUpdatesNow() : { state: 'dev' as const }));
ipcMain.handle('logs:show', (e) => {
  if (!fromApp(e.sender)) return;
  const dir = app.getPath('userData');
  const file = join(dir, 'radio-net.log');
  if (existsSync(file)) shell.showItemInFolder(file);
  else void shell.openPath(dir);
});
ipcMain.handle('app:facts', (e) => ({
  packaged: fromApp(e.sender) ? app.isPackaged : false,
  platform: process.platform,
  arch: process.arch,
}));
ipcMain.on('log:event', (e, event: unknown, detail: unknown) => {
  if (!fromApp(e.sender)) return;
  const parsed = parseLogEvent(event, detail);
  if (parsed) clientLog(parsed.event, parsed.detail);
});

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
    callback(shouldAllowMedia(permission, mediaTypesOf(details)));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission, _origin, details) => shouldAllowMedia(permission, mediaTypesOf(details)));
  if (app.isPackaged) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [RENDERER_CSP] },
      });
    });
  }
  createMain();
  createOverlay();
  const profile = readProfile();
  hotkeys.setBinds(withBindDefaults(profile.keybinds ?? DEFAULT_BINDS));
  if (profile.privacyAccepted && profile.hotkeysEnabled) {
    try { hotkeys.start(); } catch (err) {
      clientLog('hotkeys', 'start failed');
      console.error('global hotkeys unavailable', err);
    }
  }
  startUpdater(() => main);
});
app.on('window-all-closed', () => { hotkeys.stop(); app.quit(); });
