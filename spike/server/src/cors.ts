/** GitHub Pages origin. The path (/radio-net/) is not part of the Origin header. */
export const PAGES_ORIGIN = 'https://tubss2.github.io';

/**
 * Origins allowed to call the API from a browser.
 * Missing and "null" stay allowed: the Electron build loads from file:// and sends one of those.
 * A lookalike host such as tubss2.github.io.evil.example is not the Pages site.
 */
export function isAllowedApiOrigin(origin: string | undefined | null): boolean {
  if (!origin || origin === 'null') return true;
  if (origin === PAGES_ORIGIN) return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}
