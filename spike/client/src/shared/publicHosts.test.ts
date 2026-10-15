import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PUBLIC_API_HOST, PUBLIC_API_ORIGIN, PUBLIC_VOICE_HOST, PUBLIC_VOICE_ORIGIN, PUBLIC_VOICE_WSS } from './publicHosts';

const repoRoot = join(import.meta.dirname, '../../../..');

function read(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

describe('public hosts', () => {
  it('uses api.5by5.app and voice.5by5.app', () => {
    expect(PUBLIC_API_HOST).toBe('api.5by5.app');
    expect(PUBLIC_VOICE_HOST).toBe('voice.5by5.app');
    expect(PUBLIC_API_ORIGIN).toBe('https://api.5by5.app');
    expect(PUBLIC_VOICE_ORIGIN).toBe('https://voice.5by5.app');
    expect(PUBLIC_VOICE_WSS).toBe('wss://voice.5by5.app');
  });

  it('shares those names from one module and does not keep the old IP hostname', () => {
    for (const rel of [
      'spike/client/src/renderer/src/lib/api.ts',
      'spike/client/src/shared/pagesCsp.ts',
      'spike/client/src/shared/phonePage.ts',
    ]) {
      const text = read(rel);
      expect(text, rel).toContain('publicHosts');
      expect(text, rel).not.toContain('149.28.170.200');
      expect(text, rel).not.toContain('sslip.io');
    }
  });

  it('bakes the same names into the web app and the installer', () => {
    for (const rel of [
      '.github/workflows/ui-preview.yml',
      '.github/workflows/windows-installer.yml',
    ]) {
      const text = read(rel);
      expect(text, rel).toContain(`https://${PUBLIC_API_HOST}`);
      expect(text, rel).toContain(`wss://${PUBLIC_VOICE_HOST}`);
      expect(text, rel).not.toContain('149.28.170.200');
      expect(text, rel).not.toContain('sslip.io');
    }
  });

  it('passes the stable hosts from the deploy scripts and keeps the sslip default in setup.sh', () => {
    for (const rel of ['deploy/deploy.ps1', 'deploy/deploy.sh', 'deploy/deploy.py']) {
      const text = read(rel);
      expect(text, rel).toContain(PUBLIC_API_HOST);
      expect(text, rel).toContain(PUBLIC_VOICE_HOST);
      expect(text, rel).not.toContain('149.28.170.200');
    }
    const setup = read('deploy/setup.sh');
    expect(setup).toContain('API_HOST="${API_HOST:-radio-${DASHED}.sslip.io}"');
    expect(setup).toContain('LK_HOST="${LK_HOST:-lk-${DASHED}.sslip.io}"');
    expect(setup).toContain(PUBLIC_API_HOST);
    expect(setup).toContain(PUBLIC_VOICE_HOST);
    expect(setup).toContain('/var/lib/radionet/store.json');
  });
});
