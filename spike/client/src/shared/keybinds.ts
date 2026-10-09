import type { Bind, Keybinds } from './types';

/**
 * Numeric codes from uiohook-napi's UiohookKey (libuiohook).
 * Hardcoded so the renderer and the preload never import the native module.
 * G = 34, F10 = 68, Escape = 1. Mouse buttons are 1-based (4 = Mouse 4).
 */
export const UIO_ESCAPE = 1;
export const UIO_G = 34;
export const UIO_F10 = 68;

export const DEFAULT_BINDS: Keybinds = {
  ptt: { kind: 'mouse', button: 4, label: 'Mouse 4' },
  cycle: { kind: 'mouse', button: 5, label: 'Mouse 5' },
  overlay: { kind: 'key', keycode: UIO_F10, label: 'F10' },
  wheel: { kind: 'key', keycode: UIO_G, label: 'G' },
  direct: {},
  select: {},
};

export function bindId(b: Bind): string {
  return b.kind === 'key' ? `k${b.keycode}` : `m${b.button}`;
}

export function cloneBinds(b: Keybinds = DEFAULT_BINDS): Keybinds {
  return {
    ptt: b.ptt ? { ...b.ptt } : null,
    cycle: b.cycle ? { ...b.cycle } : null,
    overlay: b.overlay ? { ...b.overlay } : null,
    wheel: b.wheel ? { ...b.wheel } : null,
    direct: { ...b.direct },
    select: { ...b.select },
  };
}

/** Fill anything an older saved profile might have omitted. */
export function withBindDefaults(b: Keybinds | null | undefined): Keybinds {
  if (!b) return cloneBinds();
  return {
    ptt: b.ptt ?? null,
    cycle: b.cycle ?? null,
    overlay: b.overlay ?? null,
    wheel: b.wheel ?? null,
    direct: b.direct ?? {},
    select: b.select ?? {},
  };
}

const NAMED = ['ptt', 'wheel', 'overlay', 'cycle'] as const;

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
  push('ptt', 'Push-to-talk', binds.ptt);
  push('wheel', 'Open channel wheel', binds.wheel);
  push('overlay', 'Show or hide overlay', binds.overlay);
  push('cycle', 'Cycle transmit channel', binds.cycle);
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
