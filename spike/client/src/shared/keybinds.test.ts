import { describe, expect, it } from 'vitest';
import {
  cloneBinds,
  conflicts,
  DEFAULT_BINDS,
  isLegacyDefaultKeybinds,
  KEYBINDS_VERSION,
  migrateDesktopKeybinds,
  pageKeybinds,
  setSlot,
  UIO_F1,
  UIO_F2,
  UIO_F3,
  UIO_F4,
  UIO_F5,
  UIO_F10,
  UIO_G,
  withBindDefaults,
} from './keybinds';
import { parseFreqInput, formatFreqKHz } from './freq';

const legacyDefaults = {
  ptt: { kind: 'mouse' as const, button: 4, label: 'Mouse 4' },
  cycle: { kind: 'mouse' as const, button: 5, label: 'Mouse 5' },
  overlay: { kind: 'key' as const, keycode: UIO_F10, label: 'F10' },
  wheel: { kind: 'key' as const, keycode: UIO_F2, label: 'F2' },
  direct: {},
  select: {},
};

describe('keybinds', () => {
  it('defaults and reset are F1 talk, F2 overlay, F3 previous, F4 next and F5 wheel, with no clashes', () => {
    expect(DEFAULT_BINDS.ptt).toMatchObject({ kind: 'key', keycode: UIO_F1, label: 'F1' });
    expect(DEFAULT_BINDS.overlay).toMatchObject({ kind: 'key', keycode: UIO_F2, label: 'F2' });
    expect(DEFAULT_BINDS.prev).toMatchObject({ kind: 'key', keycode: UIO_F3, label: 'F3' });
    expect(DEFAULT_BINDS.next).toMatchObject({ kind: 'key', keycode: UIO_F4, label: 'F4' });
    expect(DEFAULT_BINDS.wheel).toMatchObject({ kind: 'key', keycode: UIO_F5, label: 'F5' });
    expect(cloneBinds().wheel).toEqual(DEFAULT_BINDS.wheel);
    expect(conflicts(DEFAULT_BINDS)).toEqual([]);
  });

  it('keeps a saved wheel bind instead of replacing it with F5', () => {
    const saved = { ...DEFAULT_BINDS, wheel: { kind: 'key' as const, keycode: UIO_G, label: 'G' } };
    expect(withBindDefaults(saved).wheel).toMatchObject({ keycode: UIO_G, label: 'G' });
    const migrated = migrateDesktopKeybinds(saved, KEYBINDS_VERSION);
    expect(migrated.changed).toBe(false);
    expect(migrated.keybinds?.wheel).toMatchObject({ keycode: UIO_G, label: 'G' });
    expect(migrated.keybinds?.ptt).toMatchObject({ keycode: UIO_F1 });
  });

  it('moves an untouched old default profile onto F1–F5', () => {
    expect(isLegacyDefaultKeybinds(legacyDefaults)).toBe(true);
    const migrated = migrateDesktopKeybinds(legacyDefaults, 0);
    expect(migrated.changed).toBe(true);
    expect(migrated.version).toBe(KEYBINDS_VERSION);
    expect(migrated.keybinds).toEqual(cloneBinds());
  });

  it('keeps a custom talk key and turns the old change-TX bind into next', () => {
    const custom = {
      ...legacyDefaults,
      ptt: { kind: 'key' as const, keycode: UIO_G, label: 'G' },
    };
    const migrated = migrateDesktopKeybinds(custom, undefined);
    expect(migrated.changed).toBe(true);
    expect(migrated.version).toBe(KEYBINDS_VERSION);
    expect(migrated.keybinds?.ptt).toMatchObject({ keycode: UIO_G, label: 'G' });
    expect(migrated.keybinds?.next).toMatchObject({ kind: 'mouse', button: 5, label: 'Mouse 5' });
    expect(migrated.keybinds?.prev).toBeNull();
    expect(migrated.keybinds?.overlay).toMatchObject({ keycode: UIO_F10 });
    expect(migrated.keybinds?.wheel).toMatchObject({ keycode: UIO_F2 });
  });

  it('does not put the old mouse defaults back onto F1–F5 once the profile version is current', () => {
    const chosen = {
      ptt: legacyDefaults.ptt,
      prev: null,
      next: legacyDefaults.cycle,
      overlay: legacyDefaults.overlay,
      wheel: legacyDefaults.wheel,
      direct: {},
      select: {},
    };
    const migrated = migrateDesktopKeybinds(chosen, KEYBINDS_VERSION);
    expect(migrated.changed).toBe(false);
    expect(migrated.keybinds?.ptt).toMatchObject({ kind: 'mouse', button: 4 });
    expect(migrated.keybinds?.next).toMatchObject({ kind: 'mouse', button: 5 });
    expect(migrated.keybinds?.prev).toBeNull();
    expect(migrated.keybinds?.wheel).toMatchObject({ keycode: UIO_F2 });
    expect(migrated.keybinds?.overlay).toMatchObject({ keycode: UIO_F10 });
  });

  it('keeps old default keys when a quick-select was saved as well', () => {
    const withQuick = {
      ...legacyDefaults,
      select: { cmd: { kind: 'key' as const, keycode: UIO_G, label: 'G' } },
    };
    const migrated = migrateDesktopKeybinds(withQuick, 0);
    expect(migrated.keybinds?.ptt).toMatchObject({ button: 4 });
    expect(migrated.keybinds?.next).toMatchObject({ button: 5 });
    expect(migrated.keybinds?.prev).toBeNull();
    expect(migrated.keybinds?.select.cmd).toMatchObject({ keycode: UIO_G, label: 'G' });
  });

  it('leaves a profile that never saved binds on the current defaults', () => {
    const migrated = migrateDesktopKeybinds(null, 0);
    expect(migrated.changed).toBe(false);
    expect(migrated.keybinds).toBeNull();
    expect(withBindDefaults(migrated.keybinds)).toEqual(cloneBinds());
  });

  it('keeps the in-page preview on Space, F2 and F10', () => {
    const page = pageKeybinds(null, true);
    expect(page.ptt).toMatchObject({ label: 'Space' });
    expect(page.wheel).toMatchObject({ keycode: UIO_F2, label: 'F2' });
    expect(page.overlay).toMatchObject({ keycode: UIO_F10, label: 'F10' });
    expect(page.prev).toBeNull();
    expect(page.next).toBeNull();
  });

  it('shows a conflict and still keeps both binds', () => {
    const next = setSlot(setSlot(DEFAULT_BINDS, 'wheel', DEFAULT_BINDS.ptt), 'select:cmd', { kind: 'key', keycode: 34, label: 'G' });
    expect(next.wheel?.label).toBe('F1');
    expect(next.ptt?.label).toBe('F1');
    expect(conflicts(next, { 'select:cmd': 'Quick select 59.5 Command' }).join(' ')).toMatch(/Talk and Channel wheel/);
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
