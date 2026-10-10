import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPinnedUpdateFeed, UPDATE_CHECK_INTERVAL_MS, UPDATE_OWNER, UPDATE_REPO } from './updates';

const repoRoot = join(import.meta.dirname, '../../../..');

describe('GitHub Releases updates', () => {
  it('checks the public Tubss2/radio-net releases every four hours', () => {
    expect(UPDATE_OWNER).toBe('Tubss2');
    expect(UPDATE_REPO).toBe('radio-net');
    expect(UPDATE_CHECK_INTERVAL_MS).toBe(4 * 60 * 60 * 1000);
    expect(isPinnedUpdateFeed({ provider: 'github', owner: UPDATE_OWNER, repo: UPDATE_REPO })).toBe(true);
    expect(isPinnedUpdateFeed({ provider: 'github', owner: 'someone', repo: UPDATE_REPO })).toBe(false);
    expect(isPinnedUpdateFeed({ provider: 'generic', owner: UPDATE_OWNER, repo: UPDATE_REPO })).toBe(false);
  });

  it('publishes a public release and does not require a code signature', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'spike/client/package.json'), 'utf8')) as {
      version: string;
      build: {
        publish: { provider: string; owner: string; repo: string; releaseType?: string; private?: boolean };
        win: { verifyUpdateCodeSignature?: boolean };
      };
    };
    expect(pkg.version).toBe('0.4.6');
    expect(pkg.build.publish).toEqual({
      provider: 'github',
      owner: UPDATE_OWNER,
      repo: UPDATE_REPO,
      releaseType: 'release',
      private: false,
    });
    expect(pkg.build.win.verifyUpdateCodeSignature).toBe(false);
    const fuses = JSON.parse(readFileSync(join(repoRoot, 'spike/client/package.json'), 'utf8')) as {
      build: { electronFuses: Record<string, boolean> };
    };
    expect(fuses.build.electronFuses).toEqual({
      runAsNode: false,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true,
    });
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
    expect(yml).toContain('continue-on-error: true');
    expect(yml).toContain('!cancelled()');
    expect(yml).toContain('gh release edit');
    expect(yml).toContain('--latest');
    expect(yml.lastIndexOf('Get-FileHash')).toBeGreaterThan(yml.indexOf('continue-on-error: true'));
    expect(yml).toContain('actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1');
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
    expect(yml).toContain('actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1');
    expect(yml).toContain('spike/client/preview-dist');
    expect(yml).toContain('spike/client/web-dist');
    expect(yml).toContain('name: web-site');
  });

  it('publishes a new helper tag only when approved and leaves the desktop updater alone', () => {
    const yml = readFileSync(join(repoRoot, '.github/workflows/ptt-helper.yml'), 'utf8');
    expect(yml).toContain('RadioNetHelper.exe');
    expect(yml).toContain('name: RadioNetHelper');
    expect(yml).toContain('contents: read');
    expect(yml).toContain('publish-new-helper');
    expect(yml).toContain('HELPER_DOWNLOAD_URL');
    expect(yml).toContain("github.event_name == 'workflow_dispatch'");
    expect(yml).toContain("github.ref == 'refs/heads/main'");
    expect(yml).toContain('gh release create');
    expect(yml).toContain('--latest=false');
    expect(yml).toContain('Refusing to replace a published exe.');
    expect(yml).not.toContain('gh release upload');
    expect(yml).not.toContain('--clobber');
    expect(yml).not.toContain('helper-1');
    expect(yml).not.toContain('helper-2');
    expect(yml).not.toContain('helper-3');
    expect(yml).not.toContain('helper-4');
    expect(yml).not.toContain('softprops/action-gh-release');
    expect(yml).not.toContain('electron-builder');
    expect(yml).not.toContain('latest.yml');
    expect(yml).not.toContain('/releases/latest');
  });
});
