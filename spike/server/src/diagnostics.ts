import { z } from 'zod';
import { redactSecrets } from './redact.js';

const finite = z.number().finite().min(0).max(1_000_000);
const summary = z.object({ p50: finite, p95: finite, max: finite });

/** Voice-quality summary. Unknown fields are dropped, so a callsign cannot be stored by adding a key. */
export const voiceReportSchema = z.object({
  v: z.literal(1),
  clientId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
  appVersion: z.string().min(1).max(32),
  surface: z.enum(['web', 'electron']),
  browser: z.string().min(1).max(40),
  platform: z.string().max(40),
  mobile: z.boolean(),
  tuned: z.number().int().min(0).max(32),
  reconnects: z.number().int().min(0).max(1_000_000),
  disconnects: z.number().int().min(0).max(1_000_000),
  pttPresses: z.number().int().min(0).max(1_000_000),
  pttFailures: z.number().int().min(0).max(1_000_000),
  rttMs: summary,
  jitterMs: summary,
  lossPct: summary,
  rooms: z.array(z.object({
    freq: z.string().regex(/^\d{2}\.\d$/),
    reconnects: z.number().int().min(0).max(1_000_000),
    rttMsP50: finite,
    jitterMsP95: finite,
    lossPctP95: finite,
  })).max(16),
});

export const errorReportSchema = z.object({
  v: z.literal(1),
  message: z.string().max(2_000),
  stack: z.string().max(4_000),
  source: z.enum(['window', 'unhandledrejection']),
  appVersion: z.string().min(1).max(32),
  surface: z.enum(['web', 'electron']),
  browser: z.string().min(1).max(40),
  path: z.string().max(160),
});

export type VoiceReport = z.infer<typeof voiceReportSchema>;
export type ErrorReport = z.infer<typeof errorReportSchema>;

export function cleanVoice(input: unknown): VoiceReport {
  return voiceReportSchema.parse(input);
}

export function cleanError(input: unknown): ErrorReport {
  const parsed = errorReportSchema.parse(input);
  return {
    ...parsed,
    message: redactSecrets(parsed.message).slice(0, 300),
    stack: redactSecrets(stripQuery(parsed.stack)).slice(0, 1_500),
    path: safePath(parsed.path),
  };
}

function stripQuery(text: string): string {
  return text.replace(/https?:\/\/[^\s)]+/g, (url) => url.split('?')[0] ?? url);
}

function safePath(path: string): string {
  if (!path.startsWith('/') || path.includes('..') || path.includes('?') || path.includes('\\')) return '/';
  return path.slice(0, 120);
}
