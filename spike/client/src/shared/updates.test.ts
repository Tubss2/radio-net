import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanUpdateError, cleanUpdateVersion, formatUpdateBytes, formatUpdateProgressLine, formatUpdateSpeed, initialUpdateSession, isPinnedUpdateFeed, parseUpdateProgress, reduceUpdateSession, UPDATE_CHECK_INTERVAL_MS, UPDATE_INSTALLER_NOTE, UPDATE_INSTALLING_NOTE, UPDATE_OWNER, UPDATE_REPO, updateFlowCopy } from './updates';

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
        nsis: { artifactName?: string };
      };
    };
    expect(pkg.version).toBe('0.4.11');
    expect(pkg.build.publish).toEqual({
      provider: 'github',
      owner: UPDATE_OWNER,
      repo: UPDATE_REPO,
      releaseType: 'release',
      private: false,
    });
    expect(pkg.build.win.verifyUpdateCodeSignature).toBe(false);
    expect(pkg.build.nsis.artifactName).toBe('RadioNet-Setup-${version}.${ext}');
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
    expect(setup).toContain('sha256sum -c -');
    expect(setup).toContain('Strict-Transport-Security "max-age=31536000"');
    expect(setup).not.toMatch(/curl -fsSL[^\n]*\| tar/);
  });

  it('publishes the installer from a version tag without giving npm a write token', () => {
    const yml = readFileSync(join(repoRoot, '.github/workflows/windows-installer.yml'), 'utf8');
    const publishAt = yml.indexOf('\n  publish:\n');
    expect(publishAt).toBeGreaterThan(0);
    const build = yml.slice(0, publishAt);
    const publish = yml.slice(publishAt);
    expect(build).toContain('contents: read');
    expect(build).not.toContain('contents: write');
    expect(build).toContain('persist-credentials: false');
    expect(build).toContain('npm ci');
    expect(build).toContain('npm run dist:win');
    expect(build).not.toContain('secrets.GITHUB_TOKEN');
    expect(build).not.toContain('--publish always');
    expect(publish).toContain('contents: write');
    expect(publish).toContain('pull-requests: read');
    expect(publish).toContain('issues: read');
    expect(publish).not.toContain('issues: write');
    expect(publish).toContain('user.login');
    expect(publish).toContain('performed_via_github_app.slug');
    expect(publish).toContain("-cmatch '^Security review: approved'");
    expect(publish).toContain("-ceq 'Tubss2'");
    expect(publish).toContain("-ceq 'cursor[bot]'");
    expect(publish).toContain("-ceq 'cursor'");
    expect(publish).toContain('CHANGES_REQUESTED');
    expect(build).not.toContain('issues: read');
    expect(build).not.toContain('issues: write');
    expect(publish).toContain('environment: release');
    expect(publish).toContain('secrets.GITHUB_TOKEN');
    expect(publish).toContain("github.ref == 'refs/heads/main'");
    expect(publish).toContain('Security review: approved');
    expect(publish).toContain('Not replacing its files.');
    expect(publish).toContain('gh release create');
    expect(publish).toContain('gh release edit');
    expect(publish).toContain('--latest');
    expect(publish).toContain('--target');
    expect(publish).toContain('GITHUB_REPOSITORY');
    expect(publish).not.toContain('gh release upload');
    expect(publish).not.toContain('--clobber');
    const ghLines = publish.split('\n').filter((line) => line.includes('gh release'));
    expect(ghLines.length).toBe(3);
    for (const line of ghLines) expect(line).toContain('--repo');
    expect(publish).not.toContain('npm');
    expect(publish).not.toContain('npx');
    expect(publish).not.toContain('--publish always');
    expect(yml).toContain('latest.yml');
    expect(yml).toContain('SHA256SUMS.txt');
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
    expect(yml).toContain("github.ref == 'refs/heads/main'");
    expect(yml).not.toContain('local-callsign-keybinds');
  });

  it('publishes a new helper tag from a reviewed merge to main and leaves the desktop updater alone', () => {
    const yml = readFileSync(join(repoRoot, '.github/workflows/ptt-helper.yml'), 'utf8');
    expect(yml).toContain('cargo build --release --locked');
    expect(yml).toContain('SHA256SUMS.txt');
    expect(yml).toContain('RadioNetHelper.exe');
    expect(yml).toContain('name: RadioNetHelper');
    expect(yml).toContain('contents: read');
    expect(yml).toContain('pull-requests: read');
    expect(yml).toContain('issues: read');
    expect(yml).not.toContain('issues: write');
    expect(yml).toContain('user.login');
    expect(yml).toContain('performed_via_github_app.slug');
    expect(yml).toContain("-cmatch '^Security review: approved'");
    expect(yml).toContain("-ceq 'Tubss2'");
    expect(yml).toContain("-ceq 'cursor[bot]'");
    expect(yml).toContain("-ceq 'cursor'");
    expect(yml).toContain('CHANGES_REQUESTED');
    expect(yml).toContain('Security review: approved');
    expect(yml).toContain('HELPER_DOWNLOAD_URL');
    expect(yml).toContain("github.event_name == 'push'");
    expect(yml).toContain("github.ref == 'refs/heads/main'");
    expect(yml).not.toContain('publish-new-helper');
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

  it('sends download progress and update errors to the window', () => {
    const updater = readFileSync(join(repoRoot, 'spike/client/src/main/updater.ts'), 'utf8');
    const preload = readFileSync(join(repoRoot, 'spike/client/src/preload/index.ts'), 'utf8');
    expect(updater).toContain("autoUpdater.on('download-progress'");
    expect(updater).toContain("'update:progress'");
    expect(updater).toContain("'update:error'");
    expect(updater).toContain('parseUpdateProgress');
    expect(updater).toContain('cleanUpdateError');
    expect(preload).toContain("'update:progress'");
    expect(preload).toContain("'update:error'");
  });
});

describe('update progress', () => {
  const total = 30 * 1024 * 1024;
  const transferred = Math.round(12.4 * 1024 * 1024);
  const progress = { percent: 42.2, transferred, total, bytesPerSecond: 2.5 * 1024 * 1024 };

  it('keeps a progress payload that is only finite byte counts', () => {
    expect(cleanUpdateVersion('0.4.10')).toBe('0.4.10');
    expect(cleanUpdateVersion('0.4.10\n<script>')).toBeNull();
    expect(cleanUpdateVersion('latest')).toBeNull();
    expect(parseUpdateProgress(progress)?.percent).toBe(42.2);
    expect(parseUpdateProgress({ ...progress, percent: 140 })?.percent).toBe(100);
    expect(parseUpdateProgress({ percent: 10, transferred: 1, total: 2 })).toMatchObject({ bytesPerSecond: 0 });
    expect(parseUpdateProgress({ percent: Number.NaN, transferred: 1, total: 2, bytesPerSecond: 1 })).toBeNull();
    expect(parseUpdateProgress({ percent: -1, transferred: 1, total: 2, bytesPerSecond: 1 })).toBeNull();
    expect(parseUpdateProgress(null)).toBeNull();
    expect(cleanUpdateError(new Error('token ghp_abcdefghijklmnopqrstuvwxyz'))).toBe('token [redacted]');
    expect(formatUpdateBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(formatUpdateSpeed(2.5 * 1024 * 1024)).toBe('2.5 MB/s');
    expect(formatUpdateSpeed(500 * 1024)).toBe('500 KB/s');
    expect(formatUpdateProgressLine(progress)).toBe(`42% · ${formatUpdateBytes(transferred)} / ${formatUpdateBytes(total)} · 2.5 MB/s`);
  });

  it('shows percent and size while downloading, then an indeterminate installer step', () => {
    let session = reduceUpdateSession(initialUpdateSession, { type: 'available', version: '0.4.10' });
    expect(session.banner).toBe(true);
    expect(updateFlowCopy(session.flow)?.showDownload).toBe(true);
    expect(updateFlowCopy(session.flow)?.version).toBe('0.4.10');

    session = reduceUpdateSession(session, { type: 'download' });
    expect(session.flow).toMatchObject({ phase: 'downloading', progress: null });
    expect(updateFlowCopy(session.flow)?.indeterminate).toBe(true);

    session = reduceUpdateSession(session, { type: 'progress', version: '0.4.10', progress });
    const copying = updateFlowCopy(session.flow);
    expect(copying?.indeterminate).toBe(false);
    expect(copying?.percent).toBe(42.2);
    expect(copying?.detail).toContain('42%');
    expect(copying?.detail).toContain('MB');
    expect(copying?.detail).toContain('2.5 MB/s');

    session = reduceUpdateSession(session, { type: 'later' });
    expect(session.banner).toBe(false);
    session = reduceUpdateSession(session, { type: 'progress', version: '0.4.10', progress: { ...progress, percent: 80 } });
    expect(session.banner).toBe(false);

    session = reduceUpdateSession(session, { type: 'error', message: 'offline' });
    expect(session.banner).toBe(true);
    expect(updateFlowCopy(session.flow)?.showRetry).toBe(true);
    expect(updateFlowCopy(session.flow)?.detail).toBe('offline');

    session = reduceUpdateSession(session, { type: 'retry' });
    expect(session.flow.phase).toBe('downloading');
    session = reduceUpdateSession(session, { type: 'ready', version: '0.4.10' });
    expect(updateFlowCopy(session.flow)?.showInstall).toBe(true);
    expect(updateFlowCopy(session.flow)?.detail).toBe(UPDATE_INSTALLER_NOTE);
    expect(updateFlowCopy(session.flow)?.percent).toBe(100);

    session = reduceUpdateSession(session, { type: 'install' });
    expect(updateFlowCopy(session.flow)?.indeterminate).toBe(true);
    expect(updateFlowCopy(session.flow)?.detail).toBe(UPDATE_INSTALLING_NOTE);
    expect(reduceUpdateSession(session, { type: 'available', version: '0.4.11' }).flow.phase).toBe('installing');
  });

  it('ignores a progress event that arrives before a version is known', () => {
    const session = reduceUpdateSession(initialUpdateSession, { type: 'progress', version: 'not-a-version', progress });
    expect(session.flow.phase).toBe('hidden');
  });
});
