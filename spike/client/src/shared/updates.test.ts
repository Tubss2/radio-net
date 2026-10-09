import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UPDATE_CHECK_INTERVAL_MS, UPDATE_OWNER, UPDATE_REPO } from './updates';

const repoRoot = join(import.meta.dirname, '../../../..');

describe('GitHub Releases updates', () => {
  it('checks the public Tubss2/radio-net releases every four hours', () => {
    expect(UPDATE_OWNER).toBe('Tubss2');
    expect(UPDATE_REPO).toBe('radio-net');
    expect(UPDATE_CHECK_INTERVAL_MS).toBe(4 * 60 * 60 * 1000);
  });

  it('publishes a public release and does not require a code signature', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'spike/client/package.json'), 'utf8')) as {
      version: string;
      build: {
        publish: { provider: string; owner: string; repo: string; releaseType?: string; private?: boolean };
        win: { verifyUpdateCodeSignature?: boolean };
      };
    };
    expect(pkg.version).toBe('0.4.3');
    expect(pkg.build.publish).toEqual({
      provider: 'github',
      owner: UPDATE_OWNER,
      repo: UPDATE_REPO,
      releaseType: 'release',
      private: false,
    });
    expect(pkg.build.win.verifyUpdateCodeSignature).toBe(false);
  });

  it('does not serve updates from the API host', () => {
    const setup = readFileSync(join(repoRoot, 'deploy/setup.sh'), 'utf8');
    expect(setup).not.toContain('/updates/');
    expect(setup).not.toContain('publish-update');
  });

  it('publishes the installer from a version tag with the Actions token', () => {
    const yml = readFileSync(join(repoRoot, '.github/workflows/windows-installer.yml'), 'utf8');
    expect(yml).toContain('contents: write');
    expect(yml).toContain('secrets.GITHUB_TOKEN');
    expect(yml).toContain('npm run dist:win');
    expect(yml).toContain('--publish always');
    expect(yml).toContain('latest.yml');
    expect(yml).toContain('SHA256SUMS.txt');
    expect(yml).toContain('actions/checkout@11d5960a326750d5838078e36cf38b85af677262');
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'spike/client/package.json'), 'utf8')) as {
      scripts: { 'dist:win': string };
    };
    expect(pkg.scripts['dist:win']).toContain('--publish never');
  });

  it('deploys the UI preview with GitHub Pages', () => {
    const yml = readFileSync(join(repoRoot, '.github/workflows/ui-preview.yml'), 'utf8');
    expect(yml).toContain('pages: write');
    expect(yml).toContain('id-token: write');
    expect(yml).toContain('actions/deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e');
    expect(yml).toContain('actions/checkout@11d5960a326750d5838078e36cf38b85af677262');
    expect(yml).toContain('spike/client/preview-dist');
  });
});
