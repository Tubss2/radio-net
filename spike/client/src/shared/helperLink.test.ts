import { describe, expect, it } from 'vitest';
import { HELPER_URL, helperPairMessage, parseHelperEvent } from './helperLink';

describe('push-to-talk helper link', () => {
  it('pairs the tray code with the page talk key or a side button', () => {
    expect(HELPER_URL).toBe('ws://127.0.0.1:47321');
    const key = helperPairMessage('K7QM2P', { kind: 'key', code: 'KeyK' });
    expect(JSON.parse(key)).toEqual({ t: 'pair', code: 'K7QM2P', watch: { kind: 'key', code: 'KeyK' } });
    expect(key.indexOf('"code"')).toBeLessThan(key.indexOf('"watch"'));
    const mouse = helperPairMessage('K7QM2P', { kind: 'mouse', button: 4 });
    expect(JSON.parse(mouse).watch).toEqual({ kind: 'mouse', button: 4 });
  });

  it('reads only ok, down, and up', () => {
    expect(parseHelperEvent('{"t":"ok"}')).toBe('ok');
    expect(parseHelperEvent('{"t":"down"}')).toBe('down');
    expect(parseHelperEvent('{"t":"up"}')).toBe('up');
    expect(parseHelperEvent('{"t":"pair"}')).toBeNull();
    expect(parseHelperEvent('nope')).toBeNull();
  });
});
