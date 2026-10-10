import { describe, expect, it } from 'vitest';
import {
  HELPER_DOWNLOAD_URL, HELPER_SOURCE_URL, HELPER_URL, forgetHelperDevice, helperCodeFromHash,
  helperForgetMessage, helperPairMessage, helperResumeMessage, parseHelperEvent, readHelperDevice,
  writeHelperDevice,
} from './helperLink';

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';

describe('push-to-talk helper link', () => {
  it('pairs with the window code and does not send a key', () => {
    expect(HELPER_URL).toBe('ws://127.0.0.1:47321');
    expect(HELPER_DOWNLOAD_URL).toBe('https://github.com/Tubss2/radio-net/releases/download/helper-3/RadioNetHelper.exe');
    expect(HELPER_SOURCE_URL).toBe('https://github.com/Tubss2/radio-net/tree/main/helper');
    const key = helperPairMessage('K7QM2P');
    expect(JSON.parse(key)).toEqual({ t: 'pair', code: 'K7QM2P' });
    expect(key).not.toContain('watch');
    expect(key).not.toContain('Key');
  });

  it('reads a one-time code from the fragment and ignores a query-style value', () => {
    expect(helperCodeFromHash('#h=K7QM2P4XR9')).toBeNull();
    expect(helperCodeFromHash('#h=K7QM2PI4XR9N')).toBeNull();
    expect(helperCodeFromHash('#h=K7QM2P4XR9NA')).toBe('K7QM2P4XR9NA');
    expect(helperCodeFromHash('#h=k7qm2p4xr9na')).toBe('K7QM2P4XR9NA');
    expect(helperCodeFromHash('#code=K7QM2P4XR9NA')).toBeNull();
    expect(helperCodeFromHash('')).toBeNull();
  });

  it('remembers a device token and still resumes an older save that named a key', () => {
    expect(TOKEN).toHaveLength(43);
    const store = new Map<string, string>();
    expect(readHelperDevice((key) => store.get(key) ?? null)).toBeNull();
    writeHelperDevice((key, value) => { store.set(key, value); }, { token: TOKEN });
    expect(readHelperDevice((key) => store.get(key) ?? null)).toEqual({ token: TOKEN });
    expect(store.get('rn.helper')).not.toContain('watch');
    const resume = helperResumeMessage(TOKEN);
    expect(JSON.parse(resume)).toEqual({ t: 'resume', token: TOKEN });
    expect(resume).not.toContain('"code"');
    expect(helperForgetMessage()).toBe('{"t":"forget"}');
    store.set('rn.helper', JSON.stringify({ token: TOKEN, watch: { kind: 'key', code: 'KeyK' } }));
    expect(readHelperDevice((key) => store.get(key) ?? null)).toEqual({ token: TOKEN });
    forgetHelperDevice((key) => { store.delete(key); });
    expect(readHelperDevice((key) => store.get(key) ?? null)).toBeNull();
    writeHelperDevice((key, value) => { store.set(key, value); }, { token: 'short' });
    expect(readHelperDevice((key) => store.get(key) ?? null)).toBeNull();
  });

  it('reads talk and channel actions and drops anything that names a key', () => {
    expect(parseHelperEvent('{"t":"ok"}')).toEqual({ t: 'ok', token: null });
    expect(parseHelperEvent(`{"t":"ok","token":"${TOKEN}"}`)).toEqual({ t: 'ok', token: TOKEN });
    expect(parseHelperEvent('{"t":"ok","token":"nope"}')).toEqual({ t: 'ok', token: null });
    expect(parseHelperEvent('{"t":"ptt","v":"down"}')).toEqual({ t: 'ptt', down: true });
    expect(parseHelperEvent('{"t":"ptt","v":"up"}')).toEqual({ t: 'ptt', down: false });
    expect(parseHelperEvent('{"t":"down"}')).toEqual({ t: 'ptt', down: true });
    expect(parseHelperEvent('{"t":"up"}')).toEqual({ t: 'ptt', down: false });
    expect(parseHelperEvent('{"t":"tx","v":"next"}')).toEqual({ t: 'tx', dir: 'next' });
    expect(parseHelperEvent('{"t":"tx","v":"prev"}')).toEqual({ t: 'tx', dir: 'prev' });
    expect(parseHelperEvent('{"t":"denied"}')).toEqual({ t: 'denied' });
    expect(parseHelperEvent('{"t":"watch","watch":{"kind":"key","code":"KeyK"}}')).toBeNull();
    expect(parseHelperEvent('{"t":"ptt","v":"down","code":"KeyA"}')).toBeNull();
    expect(parseHelperEvent('{"t":"pair"}')).toBeNull();
    expect(parseHelperEvent('nope')).toBeNull();
  });
});
