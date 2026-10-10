import { describe, expect, it } from 'vitest';
import { emptyProfile, normaliseProfile, persistableProfile } from './profile';

describe('profile secrets', () => {
  it('keeps the admin key and session when the OS can encrypt the file', () => {
    const saved = persistableProfile({
      ...emptyProfile(),
      privacyAccepted: true,
      servers: [{ id: 'c', name: 'Unit', url: 'https://radio.example', inviteCode: 'ABCD-EF23', adminKey: 'rnk_secret', token: 'eyJ.mac', tokenExp: 1, lastUsed: 't' }],
    }, { encrypt: true });
    expect(saved.servers[0].adminKey).toBe('rnk_secret');
    expect(saved.servers[0].token).toBe('eyJ.mac');
    expect(saved.privacyAccepted).toBe(true);
  });

  it('drops the admin key and session when the file would be plaintext', () => {
    const saved = persistableProfile({
      ...emptyProfile(),
      servers: [{ id: 'c', name: 'Unit', url: 'https://radio.example', inviteCode: 'ABCD-EF23', adminKey: 'rnk_secret', token: 'eyJ.mac', tokenExp: 1, lastUsed: 't' }],
    }, { encrypt: false });
    expect(saved.servers[0].adminKey).toBeUndefined();
    expect(saved.servers[0].token).toBeUndefined();
    expect(saved.servers[0].tokenExp).toBeUndefined();
    expect(saved.servers[0].inviteCode).toBe('ABCD-EF23');
  });

  it('treats a missing privacy flag as not yet accepted, and keybinds as on', () => {
    const p = normaliseProfile({ callsign: 'Toby' });
    expect(p.privacyAccepted).toBe(false);
    expect(p.hotkeysEnabled).toBe(true);
    expect(p.keybindsVersion).toBe(0);
    expect(p.wheelOn).toBe(true);
    expect(normaliseProfile({ wheelOn: false }).wheelOn).toBe(false);
    expect(normaliseProfile({ hotkeysEnabled: false }).hotkeysEnabled).toBe(false);
    expect(normaliseProfile({ keybindsVersion: 2 }).keybindsVersion).toBe(2);
    const kept = normaliseProfile({ servers: [{ id: 'c', url: 'https://radio.example', deviceRole: 'admin', deviceId: 'ab'.repeat(32), inviteCode: 'ABCD-EF23' }] });
    expect(kept.servers[0].deviceRole).toBe('admin');
    expect(kept.servers[0].deviceId).toBe('ab'.repeat(32));
  });
});
