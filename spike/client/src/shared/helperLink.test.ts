import { describe, expect, it } from 'vitest';
import {
  HELPER_URL, forgetHelperDevice, helperForgetMessage, helperPairMessage, helperResumeMessage,
  helperWatchMessage, parseHelperEvent, readHelperDevice, writeHelperDevice,
} from './helperLink';

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';

describe('push-to-talk helper link', () => {
  it('pairs the tray code with the page talk key or a side button', () => {
    expect(HELPER_URL).toBe('ws://127.0.0.1:47321');
    const key = helperPairMessage('K7QM2P', { kind: 'key', code: 'KeyK' });
    expect(JSON.parse(key)).toEqual({ t: 'pair', code: 'K7QM2P', watch: { kind: 'key', code: 'KeyK' } });
    expect(key.indexOf('"code"')).toBeLessThan(key.indexOf('"watch"'));
    const mouse = helperPairMessage('K7QM2P', { kind: 'mouse', button: 4 });
    expect(JSON.parse(mouse).watch).toEqual({ kind: 'mouse', button: 4 });
  });

  it('remembers a device token for this origin and can resume, rebind, or forget', () => {
    expect(TOKEN).toHaveLength(43);
    const store = new Map<string, string>();
    expect(readHelperDevice((key) => store.get(key) ?? null)).toBeNull();
    writeHelperDevice((key, value) => { store.set(key, value); }, { token: TOKEN, watch: { kind: 'key', code: 'KeyK' } });
    expect(readHelperDevice((key) => store.get(key) ?? null)).toEqual({ token: TOKEN, watch: { kind: 'key', code: 'KeyK' } });
    const resume = helperResumeMessage(TOKEN);
    expect(JSON.parse(resume)).toEqual({ t: 'resume', token: TOKEN });
    expect(resume).not.toContain('"code"');
    expect(JSON.parse(helperWatchMessage({ kind: 'mouse', button: 5 })).watch).toEqual({ kind: 'mouse', button: 5 });
    expect(helperForgetMessage()).toBe('{"t":"forget"}');
    forgetHelperDevice((key) => { store.delete(key); });
    expect(readHelperDevice((key) => store.get(key) ?? null)).toBeNull();
    writeHelperDevice((key, value) => { store.set(key, value); }, { token: 'short', watch: { kind: 'key', code: 'KeyK' } });
    expect(readHelperDevice((key) => store.get(key) ?? null)).toBeNull();
  });

  it('reads ok, down, up, and a denied link, and keeps a device token only on ok', () => {
    expect(parseHelperEvent('{"t":"ok"}')).toEqual({ t: 'ok', token: null });
    expect(parseHelperEvent(`{"t":"ok","token":"${TOKEN}"}`)).toEqual({ t: 'ok', token: TOKEN });
    expect(parseHelperEvent('{"t":"ok","token":"nope"}')).toEqual({ t: 'ok', token: null });
    expect(parseHelperEvent('{"t":"down"}')).toEqual({ t: 'down' });
    expect(parseHelperEvent('{"t":"up"}')).toEqual({ t: 'up' });
    expect(parseHelperEvent('{"t":"denied"}')).toEqual({ t: 'denied' });
    expect(parseHelperEvent('{"t":"pair"}')).toBeNull();
    expect(parseHelperEvent('nope')).toBeNull();
  });
});
