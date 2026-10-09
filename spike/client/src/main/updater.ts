import { app, type BrowserWindow } from 'electron';
import { autoUpdater, type NsisUpdater } from 'electron-updater';
import { UPDATE_CHECK_INTERVAL_MS } from '../shared/updates';

/**
 * Unsigned NSIS builds have no Authenticode publisher. electron-updater would
 * otherwise reject the download once a publisherName is present. Returning null
 * means "signature check passed". The feed is the public GitHub Releases page,
 * so anyone who can publish a release on this repo can ship a build the client
 * will install. Replace this with real verification when the installer is code-signed.
 */
function skipSignatureCheck(): void {
  (autoUpdater as NsisUpdater).verifyUpdateCodeSignature = async () => null;
}

/** Check public GitHub Releases on startup and every few hours. Download in the background. The window asks before restart. */
export function startUpdater(getWindow: () => BrowserWindow | null): void {
  if (!app.isPackaged) return;
  skipSignatureCheck();
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
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

export function installDownloadedUpdate(): void {
  autoUpdater.quitAndInstall(false, true);
}
