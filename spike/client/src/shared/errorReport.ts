import { browserLabel } from './voiceDiag';
import { redactSecrets } from './redact';

export interface ErrorReport {
  v: 1;
  message: string;
  stack: string;
  source: 'window' | 'unhandledrejection';
  appVersion: string;
  surface: 'web' | 'electron';
  browser: string;
  path: string;
}

/** A browser error with secrets and query strings removed. No audio and no callsign. */
export function buildErrorReport(input: {
  message: string;
  stack?: string;
  source: 'window' | 'unhandledrejection';
  appVersion: string;
  surface: 'web' | 'electron';
  userAgent: string;
  href?: string;
}): ErrorReport {
  return {
    v: 1,
    message: redactSecrets(input.message).slice(0, 300),
    stack: redactSecrets(stripQuery(input.stack ?? '')).slice(0, 1_500),
    source: input.source,
    appVersion: input.appVersion.slice(0, 32),
    surface: input.surface,
    browser: browserLabel(input.userAgent).slice(0, 40),
    path: pagePath(input.href),
  };
}

function stripQuery(text: string): string {
  return text.replace(/https?:\/\/[^\s)]+/g, (url) => url.split('?')[0] ?? url);
}

function pagePath(href: string | undefined): string {
  if (!href) return '/';
  try {
    const path = new URL(href).pathname;
    if (!path.startsWith('/') || path.includes('..')) return '/';
    return path.slice(0, 120);
  } catch {
    return '/';
  }
}
