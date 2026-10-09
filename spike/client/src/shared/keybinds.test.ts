import { describe, expect, it } from 'vitest';
import { conflicts, DEFAULT_BINDS, setSlot } from './keybinds';
import { parseFreqInput, formatFreqKHz } from './freq';

describe('keybinds', () => {
  it('defaults are Mouse 4, G, F10 and Mouse 5, with no clashes', () => {
    expect(DEFAULT_BINDS.ptt).toMatchObject({ kind: 'mouse', button: 4, label: 'Mouse 4' });
    expect(DEFAULT_BINDS.wheel).toMatchObject({ label: 'G' });
    expect(DEFAULT_BINDS.overlay).toMatchObject({ label: 'F10' });
    expect(conflicts(DEFAULT_BINDS)).toEqual([]);
  });

  it('shows a conflict and still keeps both binds', () => {
    const next = setSlot(setSlot(DEFAULT_BINDS, 'wheel', DEFAULT_BINDS.ptt), 'select:cmd', { kind: 'key', keycode: 34, label: 'G' });
    expect(next.wheel?.label).toBe('Mouse 4');
    expect(next.ptt?.label).toBe('Mouse 4');
    expect(conflicts(next, { 'select:cmd': 'Quick select 59.5 Command' }).join(' ')).toMatch(/Push-to-talk and Open channel wheel/);
    expect(setSlot(next, 'select:cmd', null).select.cmd).toBeUndefined();
  });
});

describe('frequency input', () => {
  it('accepts 50, 50.0 and 50.5 and prints one decimal', () => {
    expect(parseFreqInput('50')).toBe(50000);
    expect(parseFreqInput('50.0')).toBe(50000);
    expect(parseFreqInput('50.5')).toBe(50500);
    expect(formatFreqKHz(50000)).toBe('50.0');
    expect(formatFreqKHz(50500)).toBe('50.5');
  });
});
