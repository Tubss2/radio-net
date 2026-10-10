import type { Bind, Keybinds } from './types';

/**
 * Numeric codes from uiohook-napi's UiohookKey (libuiohook).
 * Hardcoded so the renderer and the preload never import the native module.
 * F1 = 59, F2 = 60, F3 = 61, F4 = 62, F5 = 63, G = 34, F10 = 68, Escape = 1.
 * Mouse buttons are 1-based.
 */
export const UIO_ESCAPE = 1;
export const UIO_G = 34;
export const UIO_F1 = 59;
export const UIO_F2 = 60;
export const UIO_F3 = 61;
export const UIO_F4 = 62;
export const UIO_F5 = 63;
export const UIO_F10 = 68;

/**
 * Profiles saved before this set. Bumped when the desktop defaults move, so a
 * person who later chooses an older set is not migrated again.
 * 2 was the unreleased swap (F2 overlay, F5 wheel). 3 is F2 wheel, F5 overlay.
 */
export const KEYBINDS_VERSION = 3;

/** Desktop defaults. The web in-page talk key stays Space and is not this set. */
export const DEFAULT_BINDS: Keybinds = {
  ptt: { kind: 'key', keycode: UIO_F1, label: 'F1' },
  prev: { kind: 'key', keycode: UIO_F3, label: 'F3' },
  next: { kind: 'key', keycode: UIO_F4, label: 'F4' },
  overlay: { kind: 'key', keycode: UIO_F5, label: 'F5' },
  wheel: { kind: 'key', keycode: UIO_F2, label: 'F2' },
  allCall: null,
  direct: {},
  select: {},
};

/**
 * Untouched desktop defaults from before the F-key set.
 * Talk on mouse button 4, change TX on mouse button 5, F10 overlay, F2 wheel.
 */
const LEGACY_DEFAULT_BINDS = {
  ptt: { kind: 'mouse' as const, button: 4 },
  cycle: { kind: 'mouse' as const, button: 5 },
  overlay: { kind: 'key' as const, keycode: UIO_F10 },
  wheel: { kind: 'key' as const, keycode: UIO_F2 },
};

/** Unreleased keybind version 2: F2 overlay and F5 wheel. */
const V2_DEFAULT_BINDS = {
  ptt: { kind: 'key' as const, keycode: UIO_F1 },
  prev: { kind: 'key' as const, keycode: UIO_F3 },
  next: { kind: 'key' as const, keycode: UIO_F4 },
  overlay: { kind: 'key' as const, keycode: UIO_F2 },
  wheel: { kind: 'key' as const, keycode: UIO_F5 },
};

/** A saved profile may still have the single `cycle` slot instead of prev/next. */
export interface LooseKeybinds {
  ptt?: Bind | null;
  prev?: Bind | null;
  next?: Bind | null;
  cycle?: Bind | null;
  overlay?: Bind | null;
  wheel?: Bind | null;
  allCall?: Bind | null;
  direct?: Record<string, Bind>;
  select?: Record<string, Bind>;
}

const KEY_LABELS: Record<number, string> = {
  [UIO_F1]: 'F1',
  [UIO_F2]: 'F2',
  [UIO_F3]: 'F3',
  [UIO_F4]: 'F4',
  [UIO_F5]: 'F5',
  [UIO_F10]: 'F10',
  [UIO_G]: 'G',
  [UIO_ESCAPE]: 'Escape',
};

export function bindId(b: Bind): string {
  return b.kind === 'key' ? `k${b.keycode}` : `m${b.button}`;
}

/** What to show for a slot. A missing label still names the key or mouse button. */
export function bindLabel(bind: Bind | null | undefined): string {
  if (!bind) return 'Unbound';
  const label = bind.label.trim();
  if (label) return label;
  if (bind.kind === 'mouse') return `Mouse ${bind.button}`;
  return KEY_LABELS[bind.keycode] ?? `Key ${bind.keycode}`;
}

export function cloneBinds(b: Keybinds = DEFAULT_BINDS): Keybinds {
  return {
    ptt: b.ptt ? { ...b.ptt } : null,
    prev: b.prev ? { ...b.prev } : null,
    next: b.next ? { ...b.next } : null,
    overlay: b.overlay ? { ...b.overlay } : null,
    wheel: b.wheel ? { ...b.wheel } : null,
    allCall: b.allCall ? { ...b.allCall } : null,
    direct: { ...b.direct },
    select: { ...b.select },
  };
}

/** Fill anything an older saved profile might have omitted. Null slots stay empty. */
export function withBindDefaults(b: LooseKeybinds | null | undefined): Keybinds {
  if (!b) return cloneBinds();
  return {
    ptt: b.ptt ?? null,
    prev: b.prev ?? null,
    next: b.next ?? b.cycle ?? null,
    overlay: b.overlay ?? null,
    wheel: b.wheel ?? null,
    allCall: b.allCall ?? null,
    direct: b.direct ?? {},
    select: b.select ?? {},
  };
}

function emptyMap(m: Record<string, Bind> | undefined): boolean {
  return !m || Object.keys(m).length === 0;
}

function sameSlot(saved: Bind | null | undefined, legacy: { kind: 'key'; keycode: number } | { kind: 'mouse'; button: number }): boolean {
  if (!saved || saved.kind !== legacy.kind) return false;
  if (saved.kind === 'key' && legacy.kind === 'key') return saved.keycode === legacy.keycode;
  if (saved.kind === 'mouse' && legacy.kind === 'mouse') return saved.button === legacy.button;
  return false;
}

function slotMatchesOrEmpty(saved: Bind | null | undefined, legacy: { kind: 'key'; keycode: number } | { kind: 'mouse'; button: number }): boolean {
  return saved == null || sameSlot(saved, legacy);
}

/**
 * True when every saved slot is still the pre-F-key default (or was never stored).
 * An older profile can omit the overlay and still be the untouched set. Talk has
 * to be the old mouse button, so a custom talk key is not rewritten.
 */
export function isLegacyDefaultKeybinds(raw: LooseKeybinds): boolean {
  if (raw.allCall != null) return false;
  if (!emptyMap(raw.direct) || !emptyMap(raw.select)) return false;
  if (raw.prev != null) return false;
  if (raw.next != null && !sameSlot(raw.next, LEGACY_DEFAULT_BINDS.cycle)) return false;
  if (raw.cycle != null && !sameSlot(raw.cycle, LEGACY_DEFAULT_BINDS.cycle)) return false;
  if (!sameSlot(raw.ptt, LEGACY_DEFAULT_BINDS.ptt)) return false;
  return slotMatchesOrEmpty(raw.overlay, LEGACY_DEFAULT_BINDS.overlay)
    && slotMatchesOrEmpty(raw.wheel, LEGACY_DEFAULT_BINDS.wheel);
}

/**
 * The header showed Talk "Mouse 4" and Overlay "—" when the overlay slot was
 * missing. That is still the old default, including after a version bump that
 * kept the hole. A profile that actually saved an overlay key is left alone.
 */
export function isIncompleteLegacyKeybinds(raw: LooseKeybinds): boolean {
  if (raw.overlay != null) return false;
  return isLegacyDefaultKeybinds(raw);
}

/** True when the stored binds are still the unreleased version-2 defaults and nothing else was set. */
export function isV2DefaultKeybinds(raw: LooseKeybinds): boolean {
  if (raw.allCall != null) return false;
  if (!emptyMap(raw.direct) || !emptyMap(raw.select)) return false;
  if (raw.cycle != null) return false;
  return sameSlot(raw.ptt, V2_DEFAULT_BINDS.ptt)
    && sameSlot(raw.prev, V2_DEFAULT_BINDS.prev)
    && sameSlot(raw.next, V2_DEFAULT_BINDS.next)
    && sameSlot(raw.overlay, V2_DEFAULT_BINDS.overlay)
    && sameSlot(raw.wheel, V2_DEFAULT_BINDS.wheel);
}

export interface DesktopKeybindMigration {
  /** Null means the profile never saved binds, so the live set is DEFAULT_BINDS. */
  keybinds: Keybinds | null;
  version: number;
  changed: boolean;
}

/**
 * Desktop only. Custom binds are kept. Untouched older defaults become the
 * current set: the original mouse defaults, and a version-2 profile that is
 * still exactly F1, F2 overlay, F3, F4, F5 wheel. A profile already on
 * KEYBINDS_VERSION is left alone.
 */
export function migrateDesktopKeybinds(raw: unknown, version: unknown): DesktopKeybindMigration {
  const storedVersion = typeof version === 'number' && Number.isInteger(version) && version > 0 ? version : 0;
  if (raw == null) return { keybinds: null, version: storedVersion, changed: false };
  if (typeof raw !== 'object') return { keybinds: cloneBinds(), version: KEYBINDS_VERSION, changed: true };
  const body = raw as LooseKeybinds;
  if (isIncompleteLegacyKeybinds(body)) {
    return { keybinds: cloneBinds(), version: KEYBINDS_VERSION, changed: true };
  }
  if (storedVersion >= KEYBINDS_VERSION) {
    const keybinds = cloneBinds(withBindDefaults(body));
    return { keybinds, version: storedVersion, changed: body.cycle != null };
  }
  if (isLegacyDefaultKeybinds(body) || isV2DefaultKeybinds(body)) {
    return { keybinds: cloneBinds(), version: KEYBINDS_VERSION, changed: true };
  }
  return { keybinds: cloneBinds(withBindDefaults(body)), version: KEYBINDS_VERSION, changed: true };
}

/**
 * Browser and preview. Talk stays Space: F1 opens Chrome's help, so it is not
 * the in-page talk key. The wheel is F2. The overlay toggle is F5.
 * Saved page binds are kept and are not run through the desktop migration.
 */
export function pageKeybinds(stored: LooseKeybinds | null | undefined, preview: boolean): Keybinds {
  const fresh = (): Keybinds => ({
    ptt: { kind: 'key', keycode: 0, label: preview ? 'Space' : 'Space (window only)' },
    prev: null,
    next: null,
    overlay: { kind: 'key', keycode: UIO_F5, label: 'F5' },
    wheel: { kind: 'key', keycode: UIO_F2, label: 'F2' },
    allCall: null,
    direct: {},
    select: {},
  });
  if (!stored || isOldPageDefault(stored)) return fresh();
  return withBindDefaults(stored);
}

/** Page defaults from before the overlay moved from F10 to F5. */
function isOldPageDefault(raw: LooseKeybinds): boolean {
  if (raw.allCall != null) return false;
  if (!emptyMap(raw.direct) || !emptyMap(raw.select)) return false;
  if (raw.prev != null || raw.next != null || raw.cycle != null) return false;
  const talk = raw.ptt;
  const space = talk?.kind === 'key' && talk.keycode === 0 && (talk.label === 'Space' || talk.label === 'Space (window only)');
  return Boolean(space)
    && sameSlot(raw.overlay, { kind: 'key', keycode: UIO_F10 })
    && sameSlot(raw.wheel, { kind: 'key', keycode: UIO_F2 });
}

const NAMED = ['ptt', 'prev', 'next', 'wheel', 'overlay', 'allCall'] as const;

export function setSlot(binds: Keybinds, slot: string, bind: Bind | null): Keybinds {
  const next = cloneBinds(binds);
  if ((NAMED as readonly string[]).includes(slot)) {
    next[slot as typeof NAMED[number]] = bind;
    return next;
  }
  if (slot.startsWith('select:')) {
    const id = slot.slice('select:'.length);
    if (bind) next.select[id] = bind;
    else delete next.select[id];
  }
  return next;
}

export interface OccupiedSlot {
  slot: string;
  label: string;
  bind: Bind;
}

/** Every assigned slot, so the settings screen can show two names on one key. */
export function occupied(binds: Keybinds, names: Record<string, string> = {}): OccupiedSlot[] {
  const out: OccupiedSlot[] = [];
  const push = (slot: string, label: string, bind: Bind | null) => {
    if (bind) out.push({ slot, label, bind });
  };
  push('ptt', 'Talk', binds.ptt);
  push('overlay', 'Show or hide overlay', binds.overlay);
  push('prev', 'Previous transmit channel', binds.prev);
  push('next', 'Next transmit channel', binds.next);
  push('wheel', 'Channel wheel', binds.wheel);
  push('allCall', 'All call', binds.allCall);
  for (const [id, bind] of Object.entries(binds.direct)) push(`direct:${id}`, names[id] ?? id, bind);
  for (const [id, bind] of Object.entries(binds.select)) push(`select:${id}`, names[`select:${id}`] ?? `Quick select ${id}`, bind);
  return out;
}

/** Human-readable clashes. Saving is still allowed; the list is a warning. */
export function conflicts(binds: Keybinds, names: Record<string, string> = {}): string[] {
  const groups = new Map<string, string[]>();
  for (const row of occupied(binds, names)) {
    const id = bindId(row.bind);
    const arr = groups.get(id) ?? [];
    arr.push(row.label);
    groups.set(id, arr);
  }
  return [...groups.values()].filter((labels) => labels.length > 1).map((labels) => `${labels.join(' and ')} use the same input`);
}
