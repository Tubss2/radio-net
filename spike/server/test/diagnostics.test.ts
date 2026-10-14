import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { appendJsonLine } from '../src/diagnosticsLog.js';
import { MemoryChannelStore } from '../src/store.js';
import { registerDevice } from './devices.js';

const cfg = {
  livekitUrl: 'ws://x',
  livekitHttpUrl: 'http://127.0.0.1:1',
  apiKey: 'devkey',
  apiSecret: 'secret-secret-secret-secret-secret',
  roomAdmin: { listRooms: async () => [], deleteRoom: async () => {} },
};

const voice = {
  v: 1,
  clientId: '11111111-1111-4111-8111-111111111111',
  appVersion: '0.4.9',
  surface: 'web',
  browser: 'Chrome 131',
  platform: 'Win32',
  mobile: false,
  tuned: 2,
  reconnects: 1,
  disconnects: 0,
  pttPresses: 4,
  pttFailures: 1,
  rttMs: { p50: 40, p95: 80, max: 90 },
  jitterMs: { p50: 5, p95: 12, max: 12 },
  lossPct: { p50: 0, p95: 1, max: 1 },
  rooms: [{ freq: '59.5', reconnects: 1, rttMsP50: 40, jitterMsP95: 12, lossPctP95: 1 }],
};

async function signedIn(dir: string) {
  const lines: string[] = [];
  const app = buildApp(new MemoryChannelStore(), {
    ...cfg,
    diagnosticsDir: dir,
    globalRateLimit: 1000,
    log: (line) => lines.push(line),
  });
  const created = await app.inject({ method: 'POST', url: '/api/communities', payload: { name: 'War Dogs NZ' } });
  const community = created.json().community;
  const joined = await registerDevice(app, community.inviteCode, 'Rifleman');
  const token = joined.res.json().token as string;
  return { app, token, lines };
}

describe('diagnostics API', () => {
  it('stores a voice summary for a signed-in member and drops extra personal fields', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rn-diag-'));
    const { app, token, lines } = await signedIn(dir);
    const res = await app.inject({
      method: 'POST',
      url: '/api/diagnostics/voice',
      headers: { authorization: `Bearer ${token}` },
      payload: { ...voice, callsign: 'Rifleman', audio: 'AAAA' },
    });
    expect(res.statusCode).toBe(200);
    const stored = readFileSync(join(dir, 'voice.jsonl'), 'utf8');
    expect(stored).toContain('"freq":"59.5"');
    expect(stored).not.toContain('Rifleman');
    expect(stored).not.toContain(token);
    expect(stored).not.toContain('AAAA');
    expect(lines.some((line) => line.includes(token) || line.includes('Rifleman'))).toBe(false);
  });

  it('refuses a voice summary with no session', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rn-diag-'));
    const app = buildApp(new MemoryChannelStore(), { ...cfg, diagnosticsDir: dir });
    const res = await app.inject({ method: 'POST', url: '/api/diagnostics/voice', payload: voice });
    expect(res.statusCode).toBe(401);
  });

  it('stores a redacted error without a session and rejects a bad token', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rn-diag-'));
    const app = buildApp(new MemoryChannelStore(), { ...cfg, diagnosticsDir: dir, globalRateLimit: 1000 });
    const ok = await app.inject({
      method: 'POST',
      url: '/api/diagnostics/error',
      payload: {
        v: 1,
        message: 'broke Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.abc and rnk_secretkey',
        stack: 'at app.js',
        source: 'window',
        appVersion: '0.4.9',
        surface: 'web',
        browser: 'Firefox 128',
        path: '/radio-net/?invite=nope',
      },
    });
    expect(ok.statusCode).toBe(200);
    const stored = readFileSync(join(dir, 'errors.jsonl'), 'utf8');
    expect(stored).toContain('Bearer [redacted]');
    expect(stored).toContain('rnk_[redacted]');
    expect(stored).not.toContain('rnk_secretkey');
    expect(stored).not.toContain('invite=');
    expect(stored).toContain('"path":"/"');
    const bad = await app.inject({
      method: 'POST',
      url: '/api/diagnostics/error',
      headers: { authorization: 'Bearer not-a-session' },
      payload: {
        v: 1, message: 'x', stack: '', source: 'window', appVersion: '0.4.9', surface: 'web', browser: 'Chrome 1', path: '/',
      },
    });
    expect(bad.statusCode).toBe(401);
  });

  it('returns 503 when the server has nowhere to keep reports', async () => {
    const app = buildApp(new MemoryChannelStore(), { ...cfg, globalRateLimit: 1000 });
    const res = await app.inject({
      method: 'POST',
      url: '/api/diagnostics/error',
      payload: {
        v: 1, message: 'x', stack: '', source: 'window', appVersion: '0.4.9', surface: 'web', browser: 'Chrome 1', path: '/',
      },
    });
    expect(res.statusCode).toBe(503);
  });

  it('rotates the log before it grows without bound', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rn-rotate-'));
    appendJsonLine(dir, 'errors.jsonl', { n: 1 }, 12);
    appendJsonLine(dir, 'errors.jsonl', { n: 2 }, 12);
    const current = readFileSync(join(dir, 'errors.jsonl'), 'utf8');
    const previous = readFileSync(join(dir, 'errors.jsonl.1'), 'utf8');
    expect(current).toContain('"n":2');
    expect(previous).toContain('"n":1');
  });
});
