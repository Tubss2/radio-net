import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appendClientLog, logLine, redactLog } from './clientLog';

describe('client log', () => {
  it('writes a line and strips admin keys and bearer tokens', () => {
    const line = logLine('api', 'GET /health Bearer abc.def.ghi key rnk_supersecret', new Date('2026-10-09T00:00:00.000Z'));
    expect(line).toBe('2026-10-09T00:00:00.000Z api GET /health Bearer [redacted] key rnk_[redacted]\n');
    expect(redactLog(line)).not.toContain('supersecret');
    expect(redactLog('session eyJjaWQiOiJkZXYi.macvalue access_token=sekrit')).not.toMatch(/eyJ|sekrit/);
  });

  it('rotates the file and keeps a bounded set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rn-log-'));
    for (let i = 0; i < 6; i++) appendClientLog(dir, 'tick', String(i), { maxBytes: 40, keep: 3 });
    const names = readdirSync(dir).sort();
    expect(names).toEqual(['radio-net.log', 'radio-net.log.1', 'radio-net.log.2']);
    const current = readFileSync(join(dir, 'radio-net.log'), 'utf8');
    expect(current).toContain('tick');
    expect(current.length).toBeLessThan(200);
  });
});
