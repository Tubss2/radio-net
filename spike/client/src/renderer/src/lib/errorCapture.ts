import { buildErrorReport, type ErrorReport } from '../../../shared/errorReport';
import { APP_VERSION } from '../../../shared/version';
import { API_URL } from './api';

let target = API_URL;
let sent = 0;
const MAX_REPORTS = 20;

/** Where automatic error reports go. The joined server wins over the baked default. */
export function setErrorReportTarget(url: string): void {
  if (url.startsWith('https://') || url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost')) {
    target = url.replace(/\/$/, '');
  }
}

/**
 * Send a short redacted browser error to the API.
 * Stops after a handful of reports so a loop cannot flood the server.
 * There is no Sentry SDK: the Pages content security policy only allows our API.
 */
export function installErrorCapture(): void {
  if (typeof window === 'undefined') return;
  const surface = import.meta.env.MODE === 'web' ? 'web' : 'electron';
  const send = (message: string, stack: string | undefined, source: ErrorReport['source']) => {
    if (sent >= MAX_REPORTS) return;
    if (message.includes('/api/diagnostics/error')) return;
    sent += 1;
    const report = buildErrorReport({
      message,
      stack,
      source,
      appVersion: APP_VERSION,
      surface,
      userAgent: navigator.userAgent,
      href: location.href,
    });
    void fetch(`${target}/api/diagnostics/error`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report),
      keepalive: true,
    }).catch(() => undefined);
  };
  window.addEventListener('error', (event) => {
    const error = event.error;
    send(event.message || 'Script error', error instanceof Error ? error.stack : undefined, 'window');
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    if (reason instanceof Error) send(reason.message, reason.stack, 'unhandledrejection');
    else send(typeof reason === 'string' ? reason : 'Unhandled rejection', undefined, 'unhandledrejection');
  });
}
