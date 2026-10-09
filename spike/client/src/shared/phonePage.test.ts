import { describe, expect, it } from 'vitest';
import { decodePhone, encodePhone, parsePhoneHash, phonePageUrl } from './phonePage';

describe('phone page link', () => {
  it('builds a Pages URL from the desktop app and a local URL in the browser', () => {
    const desktop = phonePageUrl({
      code: 'abc12345xyz', apiBase: 'https://radio.example', electron: true, origin: 'file://', base: '/',
    });
    expect(desktop.startsWith('https://tubss2.github.io/radio-net/#/p/')).toBe(true);
    expect(parsePhoneHash(desktop.slice(desktop.indexOf('#')))).toEqual({
      code: 'abc12345xyz', api: null,
    });
    const sydney = phonePageUrl({
      code: 'abc12345xyz', apiBase: 'https://radio-149-28-170-200.sslip.io', electron: true, origin: 'file://', base: '/',
    });
    expect(parsePhoneHash(sydney.slice(sydney.indexOf('#')))?.api).toBe('https://radio-149-28-170-200.sslip.io');
    const local = phonePageUrl({
      code: 'abc12345xyz', apiBase: 'http://127.0.0.1:8787', electron: false, origin: 'http://127.0.0.1:5175', base: '/',
    });
    expect(local.startsWith('http://127.0.0.1:5175/#/p/')).toBe(true);
    expect(parsePhoneHash(local.slice(local.indexOf('#')))?.api).toBe('http://127.0.0.1:8787');
    expect(parsePhoneHash('#/p/abc12345xyz?api=https://evil.example')).toEqual({
      code: 'abc12345xyz', api: null,
    });
    expect(parsePhoneHash('#/p/abc12345xyz?api=http://127.0.0.1:8787@evil.example')).toEqual({
      code: 'abc12345xyz', api: null,
    });
  });

  it('rejects a pairing hash whose API is not http(s)', () => {
    expect(parsePhoneHash('#/p/abc12345xyz?api=javascript:alert(1)')).toBeNull();
    expect(parsePhoneHash('#/home')).toBeNull();
  });

  it('round-trips push-to-talk, channel switch, and the radio snapshot', () => {
    const state = decodePhone(encodePhone({
      t: 'state', tx: 'cmd', on: true,
      channels: [{ id: 'cmd', freq: '59.5', name: 'Command', who: ['Rhys'] }],
    }));
    expect(state).toEqual({
      t: 'state', tx: 'cmd', on: true,
      channels: [{ id: 'cmd', freq: '59.5', name: 'Command', who: ['Rhys'] }],
    });
    expect(decodePhone(encodePhone({ t: 'ptt', down: true }))).toEqual({ t: 'ptt', down: true });
    expect(decodePhone(encodePhone({ t: 'tx', id: 'arty' }))).toEqual({ t: 'tx', id: 'arty' });
    expect(decodePhone(new TextEncoder().encode('{"t":"nope"}'))).toBeNull();
  });
});
