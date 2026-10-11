import { describe, expect, it } from 'vitest';
import { diagnosticsText } from './diagnostics';
import { cloneBinds } from './keybinds';
import { updateStatusText } from './updates';

describe('diagnostics', () => {
  it('lists the app state and leaves out secrets', () => {
    const text = diagnosticsText({
      appVersion: '0.4.5',
      platform: 'win32',
      arch: 'x64',
      packaged: true,
      privacyAccepted: true,
      hotkeysEnabled: true,
      overlayOn: true,
      wheelOn: false,
      soundsOn: true,
      soundPtt: false,
      soundTx: true,
      soundRoger: true,
      soundRogerLocal: false,
      hangMs: 200,
      simpleOn: false,
      serverCount: 1,
      binds: cloneBinds(),
    });
    expect(text).toContain('Radio Net 0.4.5');
    expect(text).toContain('Talk F1');
    expect(text).toContain('Overlay key F5');
    expect(text).toContain('Channel wheel off');
    expect(text).not.toContain('rnk_');
    expect(text).not.toContain('invite');
    expect(text).not.toContain('Bearer');
    expect(text).not.toContain('Toby');
  });

  it('redacts a bind label that was pasted from a secret', () => {
    const binds = cloneBinds();
    binds.ptt = { kind: 'key', keycode: 34, label: 'rnk_secret' };
    const text = diagnosticsText({
      appVersion: '0.4.5',
      platform: 'win32',
      arch: 'x64',
      packaged: false,
      privacyAccepted: false,
      hotkeysEnabled: false,
      overlayOn: false,
      wheelOn: true,
      soundsOn: false,
      soundPtt: true,
      soundTx: false,
      soundRoger: false,
      soundRogerLocal: true,
      hangMs: 0,
      simpleOn: true,
      serverCount: 0,
      binds,
    });
    expect(text).toContain('Talk rnk_[redacted]');
    expect(text).not.toContain('rnk_secret');
  });
});

describe('update status', () => {
  it('describes each check result in plain language', () => {
    expect(updateStatusText({ state: 'checking' })).toContain('Checking');
    expect(updateStatusText({ state: 'dev' })).toContain('installed app');
    expect(updateStatusText({ state: 'none', version: '0.4.5' })).toContain('latest');
    expect(updateStatusText({ state: 'available', version: '0.4.6' })).toContain('0.4.6');
    expect(updateStatusText({ state: 'ready', version: '0.4.6' })).toContain('downloaded');
    expect(updateStatusText({ state: 'error', message: 'Offline' })).toBe('Offline');
  });
});
