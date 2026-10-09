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
