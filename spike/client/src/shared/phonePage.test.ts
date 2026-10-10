import { describe, expect, it } from 'vitest';
import {
  decodePhone, encodePhone, formatCodeClock, parsePhoneHash, phoneChannelNote, phoneExpiryNote,
  phoneHold, phoneHostStatus, phonePageUrl, phoneRedeemError,
} from './phonePage';

describe('phone page link', () => {
  it('builds a Pages URL from the desktop app and a local URL in the browser', () => {
    const desktop = phonePageUrl({
      code: 'abc12345xyz', apiBase: 'https://radio.example', electron: true, origin: 'file://', base: '/',
    });
    expect(desktop.startsWith('https://tubss2.github.io/radio-net/#/p/')).toBe(true);
    expect(parsePhoneHash(desktop.slice(desktop.indexOf('#')))).toEqual({
      code: 'abc12345xyz', api: null, expiresAt: null,
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
      code: 'abc12345xyz', api: null, expiresAt: null,
    });
    expect(parsePhoneHash('#/p/abc12345xyz?api=http://127.0.0.1:8787@evil.example')).toEqual({
      code: 'abc12345xyz', api: null, expiresAt: null,
    });
    const expiring = phonePageUrl({
      code: 'abc12345xyz', apiBase: 'https://radio-149-28-170-200.sslip.io', electron: false,
      origin: 'https://tubss2.github.io', base: '/radio-net/', expiresAt: '2026-10-09T22:30:00.000Z',
    });
    expect(parsePhoneHash(expiring.slice(expiring.indexOf('#')))).toEqual({
      code: 'abc12345xyz',
      api: 'https://radio-149-28-170-200.sslip.io',
      expiresAt: Date.parse('2026-10-09T22:30:00.000Z'),
    });
  });

  it('rejects a pairing hash whose API is not http(s)', () => {
    expect(parsePhoneHash('#/p/abc12345xyz?api=javascript:alert(1)')).toBeNull();
    expect(parsePhoneHash('#/home')).toBeNull();
  });

  it('tells the phone to tap Connect and shows the two-minute clock', () => {
    expect(formatCodeClock(90_000)).toBe('1:30');
    expect(formatCodeClock(4_100)).toBe('0:05');
    expect(formatCodeClock(0)).toBe('0:00');
    expect(phoneHostStatus({ linked: false, makingCode: true, remainingMs: 120_000, tuned: false })).toBe('Making a code…');
    expect(phoneHostStatus({ linked: false, makingCode: false, remainingMs: 119_000, tuned: false }))
      .toBe('On the phone, tap Connect. This code expires in 1:59.');
    expect(phoneHostStatus({ linked: false, makingCode: false, remainingMs: -1, tuned: true }))
      .toBe('This code expired. Choose New code and scan again.');
    expect(phoneHostStatus({ linked: true, makingCode: false, remainingMs: 10_000, tuned: false }))
      .toBe('Phone connected. Tune a channel on this computer. The phone will show it.');
    expect(phoneHostStatus({ linked: true, makingCode: false, remainingMs: 10_000, tuned: true }))
      .toBe('Phone connected. Hold the button on the phone.');
    expect(phoneHold('idle', false)).toEqual({ label: 'Tap Connect first', enabled: false });
    expect(phoneHold('connecting', false)).toEqual({ label: 'Connecting…', enabled: false });
    expect(phoneHold('live', false)).toEqual({ label: 'Hold to talk', enabled: true });
    expect(phoneHold('live', true)).toEqual({ label: 'ON AIR', enabled: true });
    expect(phoneChannelNote('idle', 0)).toBeNull();
    expect(phoneChannelNote('live', 0)).toBe('Connected. Tune a channel on the computer.');
    expect(phoneChannelNote('live', 1)).toBeNull();
    expect(phoneExpiryNote(90_000, 'idle')).toBe('This code expires in 1:30. Tap Connect before then.');
    expect(phoneExpiryNote(-1, 'error')).toBe('This code expired. On the computer, choose New code and scan again.');
    expect(phoneExpiryNote(90_000, 'live')).toBeNull();
    expect(phoneRedeemError('That pairing code is not valid')).toContain('New code');
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
