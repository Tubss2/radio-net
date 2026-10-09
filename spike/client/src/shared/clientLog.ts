import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Current file plus two rotated copies. */
export const LOG_KEEP = 3;
export const LOG_MAX_BYTES = 256 * 1024;

/** Drop secrets before a line is written. Callers should not pass them anyway. */
export function redactLog(text: string): string {
  return text
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/rnk_[A-Za-z0-9]+/g, 'rnk_[redacted]');
}

export function logLine(event: string, detail?: string, at = new Date()): string {
  const clean = redactLog(detail ?? '').replace(/[\r\n]+/g, ' ').trim();
  return `${at.toISOString()} ${event}${clean ? ` ${clean}` : ''}\n`;
}

export function appendClientLog(dir: string, event: string, detail?: string, opts?: { maxBytes?: number; keep?: number }): void {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'radio-net.log');
  const maxBytes = opts?.maxBytes ?? LOG_MAX_BYTES;
  const keep = opts?.keep ?? LOG_KEEP;
  try {
    if (statSync(file).size >= maxBytes) rotate(file, keep);
  } catch {
    /* the file is created on the first append */
  }
  appendFileSync(file, logLine(event, detail));
}

function rotate(file: string, keep: number): void {
  rmSync(`${file}.${keep - 1}`, { force: true });
  for (let i = keep - 2; i >= 1; i--) {
    const from = `${file}.${i}`;
    if (existsSync(from)) renameSync(from, `${file}.${i + 1}`);
  }
  if (existsSync(file)) renameSync(file, `${file}.1`);
}
