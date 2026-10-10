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
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string };

export function updateStatusText(status: UpdateCheckState): string {
  if (status.state === 'checking') return 'Checking for updates…';
  if (status.state === 'dev') return 'This copy does not check for updates. The installed app does.';
  if (status.state === 'none') return 'You are on the latest version.';
  if (status.state === 'available') return `Version ${status.version} is available.`;
  if (status.state === 'ready') return `Version ${status.version} is downloaded.`;
  return status.message;
}
