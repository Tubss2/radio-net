import { app, type BrowserWindow } from 'electron';
import { autoUpdater, type NsisUpdater } from 'electron-updater';
import { isPinnedUpdateFeed, UPDATE_CHECK_INTERVAL_MS, UPDATE_OWNER, UPDATE_REPO } from '../shared/updates';
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

/**
 * Check the pinned public GitHub release on startup and every few hours.
 * Nothing is downloaded until the window asks. Nothing is installed until the user restarts.
 */
export function startUpdater(getWindow: () => BrowserWindow | null): void {
  if (!app.isPackaged) return;
  if (!isPinnedUpdateFeed(PINNED_FEED)) return;
  skipSignatureCheck();
  autoUpdater.setFeedURL(PINNED_FEED);
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.on('update-available', (info) => {
    getWindow()?.webContents.send('update:available', { version: info.version });
  });
  autoUpdater.on('update-downloaded', (info) => {
    getWindow()?.webContents.send('update:ready', { version: info.version });
  });
  autoUpdater.on('error', (err) => {
    console.error('auto-update', err);
  });
  const check = () => {
    void autoUpdater.checkForUpdates().catch((err) => console.error('auto-update', err));
  };
  check();
  const timer = setInterval(check, UPDATE_CHECK_INTERVAL_MS);
  app.once('before-quit', () => clearInterval(timer));
}

export function downloadAvailableUpdate(): void {
  if (!app.isPackaged) return;
  void autoUpdater.downloadUpdate().catch((err) => console.error('auto-update', err));
}

export function installDownloadedUpdate(): void {
  autoUpdater.quitAndInstall(false, true);
}
