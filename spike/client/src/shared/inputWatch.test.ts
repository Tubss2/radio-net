import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDS, UIO_ESCAPE, UIO_F1, UIO_F2, UIO_F5, UIO_G } from './keybinds';
import { shouldObserveInput, type WatchState } from './inputWatch';

const base = (): WatchState => ({
  binds: DEFAULT_BINDS,
  recording: false,
  enabled: true,
  wheelOpen: false,
  wheelKeyHeld: false,
});

describe('input watch', () => {
  it('keeps bound keys and drops everything else while the wheel is closed', () => {
    const state = base();
    expect(shouldObserveInput(DEFAULT_BINDS.ptt!, state)).toBe(true);
    expect(shouldObserveInput({ kind: 'key', keycode: UIO_F1, label: 'F1' }, state)).toBe(true);
    expect(shouldObserveInput({ kind: 'key', keycode: UIO_F2, label: 'F2' }, state)).toBe(true);
    expect(shouldObserveInput({ kind: 'key', keycode: UIO_F5, label: 'F5' }, state)).toBe(true);
    expect(shouldObserveInput({ kind: 'mouse', button: 4, label: 'Mouse 4' }, state)).toBe(false);
    expect(shouldObserveInput({ kind: 'key', keycode: UIO_G, label: 'G' }, state)).toBe(false);
    const allCall = { ...state, binds: { ...DEFAULT_BINDS, allCall: { kind: 'key' as const, keycode: UIO_G, label: 'G' } } };
    expect(shouldObserveInput({ kind: 'key', keycode: UIO_G, label: 'G' }, allCall)).toBe(true);
    expect(shouldObserveInput({ kind: 'key', keycode: UIO_ESCAPE, label: 'Escape' }, state)).toBe(false);
    expect(shouldObserveInput({ kind: 'key', keycode: 2, label: '1' }, state)).toBe(false);
    expect(shouldObserveInput({ kind: 'mouse', button: 1, label: 'Mouse 1' }, state)).toBe(false);
  });

  it('watches Escape and digits only while the wheel is in use', () => {
    const open = { ...base(), wheelOpen: true };
    expect(shouldObserveInput({ kind: 'key', keycode: UIO_ESCAPE, label: 'Escape' }, open)).toBe(true);
    expect(shouldObserveInput({ kind: 'key', keycode: 2, label: '1' }, open)).toBe(false);
    const held = { ...base(), wheelKeyHeld: true };
    expect(shouldObserveInput({ kind: 'key', keycode: 2, label: '1' }, held)).toBe(true);
  });

  it('drops every key when keybinds are paused, except the one being recorded', () => {
    const paused = { ...base(), enabled: false };
    expect(shouldObserveInput(DEFAULT_BINDS.ptt!, paused)).toBe(false);
    expect(shouldObserveInput({ kind: 'key', keycode: UIO_G, label: 'G' }, { ...paused, recording: true })).toBe(true);
  });
});
