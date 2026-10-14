import { app, type BrowserWindow } from 'electron';
import { autoUpdater, type NsisUpdater } from 'electron-updater';
import { cleanUpdateError, cleanUpdateVersion, isPinnedUpdateFeed, parseUpdateProgress, UPDATE_CHECK_INTERVAL_MS, UPDATE_OWNER, UPDATE_REPO, type UpdateCheckState } from '../shared/updates';
import { clientLog } from './clientLog';

const PINNED_FEED = { provider: 'github' as const, owner: UPDATE_OWNER, repo: UPDATE_REPO, private: false };

/**
 * Unsigned NSIS builds have no Authenticode publisher. electron-updater would
 * otherwise reject the download once a publisherName is present. Returning null
 * means "signature check passed".
 *
 * The SHA-512 in latest.yml is still checked against the file. That catches a
 * truncated download. It does not catch a hostile GitHub release, because the
 * same account writes both files. Remove this skip when the installer is signed
 * and publisherName is set.
 */
function skipSignatureCheck(): void {
  (autoUpdater as NsisUpdater).verifyUpdateCodeSignature = async () => null;
  clientLog('update', 'signature check skipped; installer is unsigned');
}

let windowForUpdates: (() => BrowserWindow | null) | null = null;
let pendingVersion = '';
let downloadActive = false;
let listening = false;

function send(channel: string, payload: unknown): void {
  const win = windowForUpdates?.();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(channel, payload);
}

function noteError(err: unknown, toRenderer: boolean): void {
  const message = cleanUpdateError(err);
  console.error('auto-update', message);
  clientLog('update', message);
  if (toRenderer) send('update:error', { message });
}

function rememberVersion(raw: unknown): string {
  const version = cleanUpdateVersion(raw);
  if (version) pendingVersion = version;
  return pendingVersion;
}

function bindUpdaterEvents(): void {
  if (listening) return;
  listening = true;
  autoUpdater.on('update-available', (info) => {
    const version = rememberVersion(info.version);
    if (!version) return;
    send('update:available', { version });
  });
  autoUpdater.on('download-progress', (info) => {
    send('update:progress', { version: pendingVersion, progress: parseUpdateProgress(info) });
  });
  autoUpdater.on('update-downloaded', (info) => {
    downloadActive = false;
    const version = rememberVersion(info.version);
    if (!version) return;
    send('update:ready', { version });
  });
  autoUpdater.on('error', (err) => {
    const active = downloadActive;
    downloadActive = false;
    noteError(err, active);
  });
}

/**
 * Check the pinned public GitHub release on startup and every few hours.
 * Nothing is downloaded until the window asks. Nothing is installed until the user restarts.
 */
export function startUpdater(getWindow: () => BrowserWindow | null): void {
  if (!app.isPackaged) return;
  if (!isPinnedUpdateFeed(PINNED_FEED)) return;
  windowForUpdates = getWindow;
  skipSignatureCheck();
  autoUpdater.setFeedURL(PINNED_FEED);
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = false;
  bindUpdaterEvents();
  const check = () => {
    void autoUpdater.checkForUpdates().catch((err) => noteError(err, false));
  };
  check();
  const timer = setInterval(check, UPDATE_CHECK_INTERVAL_MS);
  app.once('before-quit', () => clearInterval(timer));
}

/** One check from the Options menu. The installed app is the only copy that asks GitHub. */
export async function checkForUpdatesNow(): Promise<UpdateCheckState> {
  if (!app.isPackaged) return { state: 'dev' };
  if (!isPinnedUpdateFeed(PINNED_FEED)) return { state: 'error', message: 'Update feed is not the public GitHub release.' };
  skipSignatureCheck();
  autoUpdater.setFeedURL(PINNED_FEED);
  autoUpdater.autoDownload = false;
  try {
    const result = await autoUpdater.checkForUpdates();
    if (!result) return { state: 'none', version: app.getVersion() };
    const version = rememberVersion(result.updateInfo.version) || app.getVersion();
    if (result.isUpdateAvailable) return { state: 'available', version };
    return { state: 'none', version };
  } catch (err) {
    return { state: 'error', message: cleanUpdateError(err) };
  }
}

export function downloadAvailableUpdate(): void {
  if (!app.isPackaged) return;
  downloadActive = true;
  clientLog('update', pendingVersion ? `download ${pendingVersion}` : 'download');
  send('update:progress', { version: pendingVersion, progress: null });
  void autoUpdater.downloadUpdate().catch((err) => {
    downloadActive = false;
    noteError(err, true);
  });
}

export function installDownloadedUpdate(): void {
  try {
    autoUpdater.quitAndInstall(false, true);
  } catch (err) {
    noteError(err, true);
  }
}
