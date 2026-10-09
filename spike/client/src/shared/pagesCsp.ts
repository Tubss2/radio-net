/** Pinned helper port. A wildcard `ws:` would let this origin talk to any local port. */
export const HELPER_HTTP = 'http://127.0.0.1:47391';
export const HELPER_WS = 'ws://127.0.0.1:47391';

/**
 * Meta CSP for the GitHub Pages app.
 * frame-ancestors is omitted on purpose: a meta tag cannot enforce it, and Pages will not send it as a header.
 */
export const PAGES_CSP = [
  "default-src 'self'",
  `connect-src 'self' https://radio-149-28-170-200.sslip.io wss://lk-149-28-170-200.sslip.io https://lk-149-28-170-200.sslip.io ${HELPER_WS} ${HELPER_HTTP}`,
  "img-src 'self' data: blob:",
  "media-src 'self' blob: mediastream:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

/** The mocked preview at /preview/ must not be able to call the API or the helper. */
export const PREVIEW_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "media-src 'self' blob:",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

export function cspSources(policy: string, name: string): string[] {
  const match = policy.match(new RegExp(`(?:^|;\\s*)${name}\\s+([^;]+)`));
  return match ? match[1].trim().split(/\s+/) : [];
}

export function injectCsp(html: string, policy: string): string {
  if (html.includes('Content-Security-Policy')) return html;
  return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
}
