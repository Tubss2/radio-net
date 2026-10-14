import { redactSecrets } from './redact';

/** Public GitHub Releases feed baked into the installer (`provider: github`). */
export const UPDATE_OWNER = 'Tubss2';
export const UPDATE_REPO = 'radio-net';

/**
 * Check again while the app stays open. Startup always checks as well.
 * Four hours is long enough to stay quiet and short enough that a published
 * build reaches an open client the same day.
 */
export const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

export interface UpdateFeed {
  provider?: string;
  owner?: string;
  repo?: string;
}

/** The only feed the packaged app is allowed to check. */
export function isPinnedUpdateFeed(feed: UpdateFeed): boolean {
  return feed.provider === 'github' && feed.owner === UPDATE_OWNER && feed.repo === UPDATE_REPO;
}

/** What the Options menu shows after Check for updates. */
export type UpdateCheckState =
  | { state: 'dev' }
  | { state: 'checking' }
  | { state: 'none'; version: string }
  | { state: 'available'; version: string }
  | { state: 'downloading'; version: string; progress: UpdateProgress | null }
  | { state: 'ready'; version: string }
  | { state: 'installing'; version: string }
  | { state: 'error'; message: string };

/** Bytes reported by electron-updater's `download-progress` event. */
export interface UpdateProgress {
  /** 0–100. */
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
}

/** Shown once the file is downloaded. The NSIS installer runs outside the app. */
export const UPDATE_INSTALLER_NOTE = 'Windows runs the installer after you restart. That step does not report progress back to the app.';

/** Shown while quitAndInstall has started and the installer has no in-app hook. */
export const UPDATE_INSTALLING_NOTE = 'Windows is running the installer. This window does not receive progress from that step.';

export const UPDATE_PROGRESS_PENDING = 'The download has not reported a size yet.';

const MB = 1024 * 1024;
const MAX_UPDATE_BYTES = 8 * 1024 * 1024 * 1024;

/** Semver from the GitHub release, including a short pre-release suffix. */
export function cleanUpdateVersion(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const version = raw.trim();
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) return null;
  if (version.length > 32) return null;
  return version;
}

/** Drop secrets and newlines before an update error is shown or logged. */
export function cleanUpdateError(raw: unknown): string {
  const text = raw instanceof Error ? raw.message : typeof raw === 'string' ? raw : 'Could not update.';
  const message = redactSecrets(text).replace(/[\r\n]+/g, ' ').trim().slice(0, 180);
  return message || 'Could not update.';
}

function finiteByte(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_UPDATE_BYTES) return null;
  return value;
}

/** Accept a `download-progress` payload. Anything else becomes "size unknown". */
export function parseUpdateProgress(raw: unknown): UpdateProgress | null {
  if (!raw || typeof raw !== 'object') return null;
  const body = raw as Record<string, unknown>;
  const percent = finiteByte(body.percent);
  const transferred = finiteByte(body.transferred);
  const total = finiteByte(body.total);
  const bytesPerSecond = body.bytesPerSecond == null ? 0 : finiteByte(body.bytesPerSecond);
  if (percent == null || transferred == null || total == null || bytesPerSecond == null) return null;
  return {
    percent: Math.min(100, percent),
    transferred,
    total,
    bytesPerSecond,
  };
}

export function formatUpdateBytes(bytes: number): string {
  return `${(bytes / MB).toFixed(1)} MB`;
}

export function formatUpdateSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond < 1024) return `${Math.round(bytesPerSecond)} B/s`;
  if (bytesPerSecond < MB) return `${Math.round(bytesPerSecond / 1024)} KB/s`;
  return `${(bytesPerSecond / MB).toFixed(1)} MB/s`;
}

/** `42% · 12.4 MB / 30.0 MB · 1.2 MB/s` */
export function formatUpdateProgressLine(progress: UpdateProgress): string {
  const percent = Math.round(progress.percent);
  return `${percent}% · ${formatUpdateBytes(progress.transferred)} / ${formatUpdateBytes(progress.total)} · ${formatUpdateSpeed(progress.bytesPerSecond)}`;
}

export function updateStatusText(status: UpdateCheckState): string {
  if (status.state === 'checking') return 'Checking for updates…';
  if (status.state === 'dev') return 'This copy does not check for updates. The installed app does.';
  if (status.state === 'none') return 'You are on the latest version.';
  if (status.state === 'available') return `Version ${status.version} is available.`;
  if (status.state === 'downloading') {
    if (!status.progress || status.progress.total <= 0) return `Downloading version ${status.version}. ${UPDATE_PROGRESS_PENDING}`;
    return `Downloading version ${status.version}. ${formatUpdateProgressLine(status.progress)}`;
  }
  if (status.state === 'ready') return `Version ${status.version} is downloaded. ${UPDATE_INSTALLER_NOTE}`;
  if (status.state === 'installing') return `Installing version ${status.version}. ${UPDATE_INSTALLING_NOTE}`;
  return status.message;
}

/** What the update bar and the Options section are showing. */
export type UpdateFlow =
  | { phase: 'hidden' }
  | { phase: 'available'; version: string }
  | { phase: 'downloading'; version: string; progress: UpdateProgress | null }
  | { phase: 'ready'; version: string }
  | { phase: 'installing'; version: string }
  | { phase: 'error'; version: string | null; message: string };

export interface UpdateSession {
  flow: UpdateFlow;
  /** False after Later, until a ready or error result should come back. */
  banner: boolean;
}

export const initialUpdateSession: UpdateSession = { flow: { phase: 'hidden' }, banner: false };

export type UpdateEvent =
  | { type: 'available'; version: string }
  | { type: 'download' }
  | { type: 'progress'; version: string; progress: unknown }
  | { type: 'ready'; version: string }
  | { type: 'install' }
  | { type: 'error'; message: unknown }
  | { type: 'retry' }
  | { type: 'later' };

function versionOf(flow: UpdateFlow): string | null {
  if (flow.phase === 'hidden') return null;
  return flow.version;
}

/** Fold one updater event into the session both surfaces share. */
export function reduceUpdateSession(session: UpdateSession, event: UpdateEvent): UpdateSession {
  const flow = session.flow;
  switch (event.type) {
    case 'available': {
      const version = cleanUpdateVersion(event.version);
      if (!version) return session;
      if (flow.phase === 'downloading' || flow.phase === 'ready' || flow.phase === 'installing') return session;
      return { flow: { phase: 'available', version }, banner: true };
    }
    case 'download':
    case 'retry': {
      if (event.type === 'retry' && flow.phase !== 'error') return session;
      const version = versionOf(flow);
      if (!version) return session;
      if (flow.phase !== 'available' && flow.phase !== 'error' && flow.phase !== 'downloading') return session;
      const progress = flow.phase === 'downloading' ? flow.progress : null;
      return { flow: { phase: 'downloading', version, progress }, banner: true };
    }
    case 'progress': {
      if (flow.phase === 'ready' || flow.phase === 'installing') return session;
      const version = cleanUpdateVersion(event.version) ?? versionOf(flow);
      if (!version) return session;
      const progress = event.progress == null ? null : parseUpdateProgress(event.progress);
      const banner = flow.phase === 'downloading' ? session.banner : true;
      return { flow: { phase: 'downloading', version, progress }, banner };
    }
    case 'ready': {
      const version = cleanUpdateVersion(event.version) ?? versionOf(flow);
      if (!version) return session;
      return { flow: { phase: 'ready', version }, banner: true };
    }
    case 'install': {
      if (flow.phase !== 'ready' && flow.phase !== 'installing') return session;
      return { flow: { phase: 'installing', version: flow.version }, banner: true };
    }
    case 'error': {
      const message = cleanUpdateError(event.message);
      return { flow: { phase: 'error', version: versionOf(flow), message }, banner: true };
    }
    case 'later':
      return { flow, banner: false };
    default:
      return session;
  }
}

export interface UpdateFlowCopy {
  title: string;
  version: string | null;
  detail: string;
  meter: boolean;
  indeterminate: boolean;
  percent: number | null;
  meterLabel: string;
  showDownload: boolean;
  showRetry: boolean;
  showInstall: boolean;
}

/** Labels for the update bar. A null progress or a zero total is an indeterminate meter. */
export function updateFlowCopy(flow: UpdateFlow): UpdateFlowCopy | null {
  if (flow.phase === 'hidden') return null;
  if (flow.phase === 'available') {
    return {
      title: 'Update available',
      version: flow.version,
      detail: `Version ${flow.version} is available.`,
      meter: false,
      indeterminate: false,
      percent: null,
      meterLabel: '',
      showDownload: true,
      showRetry: false,
      showInstall: false,
    };
  }
  if (flow.phase === 'downloading') {
    const known = flow.progress != null && flow.progress.total > 0;
    const percent = known ? flow.progress!.percent : null;
    return {
      title: 'Downloading update',
      version: flow.version,
      detail: known ? formatUpdateProgressLine(flow.progress!) : UPDATE_PROGRESS_PENDING,
      meter: true,
      indeterminate: !known,
      percent,
      meterLabel: known ? `Downloading update, ${Math.round(percent!)} percent` : 'Downloading update, progress not reported yet',
      showDownload: false,
      showRetry: false,
      showInstall: false,
    };
  }
  if (flow.phase === 'ready') {
    return {
      title: 'Update downloaded',
      version: flow.version,
      detail: UPDATE_INSTALLER_NOTE,
      meter: true,
      indeterminate: false,
      percent: 100,
      meterLabel: 'Update downloaded',
      showDownload: false,
      showRetry: false,
      showInstall: true,
    };
  }
  if (flow.phase === 'installing') {
    return {
      title: 'Installing update',
      version: flow.version,
      detail: UPDATE_INSTALLING_NOTE,
      meter: true,
      indeterminate: true,
      percent: null,
      meterLabel: 'Installing update, progress not reported',
      showDownload: false,
      showRetry: false,
      showInstall: false,
    };
  }
  return {
    title: 'Update failed',
    version: flow.version,
    detail: flow.message,
    meter: false,
    indeterminate: false,
    percent: null,
    meterLabel: '',
    showDownload: false,
    showRetry: flow.version != null,
    showInstall: false,
  };
}
