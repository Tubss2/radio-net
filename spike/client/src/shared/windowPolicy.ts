/**
 * Renderer lockdown shared by the main process and the HTML CSP.
 * connect-src still allows any https/wss host: each community names its own server.
 * Scripts, frames, and objects stay on this app.
 */
export const RENDERER_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "media-src 'self' blob: mediastream:",
  "connect-src 'self' http://127.0.0.1:8787 ws://127.0.0.1:7880 http://127.0.0.1:7880 https: wss:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join('; ');

export interface RendererPreferenceOptions {
  backgroundThrottling?: boolean;
}

/** Explicit Electron flags. Sandbox on, Node off, web security on. */
export function rendererWebPreferences(preload: string, opts: RendererPreferenceOptions = {}) {
  return {
    preload,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    navigateOnDragDrop: false,
    backgroundThrottling: opts.backgroundThrottling ?? true,
  };
}

/** file:// pages we ship, or the electron-vite dev server. Nothing else. */
export function isAllowedAppUrl(url: string, devServer?: string): boolean {
  if (url.startsWith('file:')) {
    return url.includes('index.html') || url.includes('overlay.html');
  }
  if (!devServer) return false;
  try {
    const page = new URL(url);
    const dev = new URL(devServer);
    if (page.origin !== dev.origin) return false;
    return page.pathname === '/' || page.pathname.endsWith('/index.html') || page.pathname.endsWith('/overlay.html');
  } catch {
    return false;
  }
}

export function mediaTypesOf(details: unknown): string[] | undefined {
  if (!details || typeof details !== 'object' || !('mediaTypes' in details)) return undefined;
  const types = (details as { mediaTypes?: unknown }).mediaTypes;
  if (!Array.isArray(types) || !types.every((t) => typeof t === 'string')) return undefined;
  return types;
}

/** Microphone only. Camera and every other permission stay denied. */
export function shouldAllowMedia(permission: string, mediaTypes?: string[]): boolean {
  if (permission !== 'media') return false;
  const types = mediaTypes ?? ['audio'];
  return types.length > 0 && types.every((t) => t === 'audio');
}
