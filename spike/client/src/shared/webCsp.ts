/** Localhost Raw Input helper. The Pages CSP has to name this port; a wildcard ws: would not. */
export const HELPER_PORT = 47391;
export const HELPER_HTTP = `http://127.0.0.1:${HELPER_PORT}`;
export const HELPER_WS = `ws://127.0.0.1:${HELPER_PORT}`;

export const SYDNEY_API_ORIGIN = 'https://radio-149-28-170-200.sslip.io';
export const SYDNEY_LIVEKIT_ORIGIN = 'https://lk-149-28-170-200.sslip.io';
export const SYDNEY_LIVEKIT_WS = 'wss://lk-149-28-170-200.sslip.io';

/**
 * Meta CSP for the real GitHub Pages app.
 * frame-ancestors is omitted on purpose: a meta tag cannot enforce it, and Pages will not send it as a header.
 * Putting it here would look like clickjacking was fixed. See docs/SECURITY-WEB.md (W4).
 * The Electron shell keeps a wider connect-src so a community can name its own server. This string is the website.
 */
export const WEB_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "media-src 'self' blob: mediastream:",
  `connect-src 'self' ${SYDNEY_API_ORIGIN} ${SYDNEY_LIVEKIT_ORIGIN} ${SYDNEY_LIVEKIT_WS} ${HELPER_WS} ${HELPER_HTTP}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

/** The mocked preview must not be able to reach the API, LiveKit, or the helper. */
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

export function cspDirective(policy: string, name: string): string[] {
  const match = policy.match(new RegExp(`(?:^|;\\s*)${name}\\s+([^;]+)`));
  return match ? match[1].trim().split(/\s+/) : [];
}

/** Insert the preview meta tag. Vite applies this on build only, so the dev server can still use its own websocket. */
export function injectPreviewCsp(html: string): string {
  if (html.includes('Content-Security-Policy')) return html;
  const tag = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}" />`;
  return html.replace('</head>', `    ${tag}\n  </head>`);
}
