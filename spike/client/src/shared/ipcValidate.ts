import { withBindDefaults } from './keybinds';
import type { WheelInput } from './radialWheel';
import type { Bind, Keybinds, OverlayState } from './types';

function parseBind(raw: unknown): Bind | null | undefined {
  if (raw === null) return null;
  if (!raw || typeof raw !== 'object') return undefined;
  const b = raw as Partial<Bind>;
  if (b.kind === 'key' && typeof b.keycode === 'number' && Number.isInteger(b.keycode) && b.keycode >= 0 && b.keycode < 100_000 && typeof b.label === 'string' && b.label.length <= 32) {
    return { kind: 'key', keycode: b.keycode, label: b.label };
  }
  if (b.kind === 'mouse' && typeof b.button === 'number' && Number.isInteger(b.button) && b.button >= 0 && b.button < 32 && typeof b.label === 'string' && b.label.length <= 32) {
    return { kind: 'mouse', button: b.button, label: b.label };
  }
  return undefined;
}

function parseBindMap(raw: unknown): Record<string, Bind> | null {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, Bind> = {};
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > 32) return null;
  for (const [id, value] of entries) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
    const bind = parseBind(value);
    if (!bind) return null;
    out[id] = bind;
  }
  return out;
}

/** Reject a keybind payload that is not a small map of keys and mouse buttons. */
export function parseKeybinds(raw: unknown): Keybinds | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Partial<Keybinds> & { cycle?: unknown };
  const direct = parseBindMap(b.direct ?? {});
  const select = parseBindMap(b.select ?? {});
  if (!direct || !select) return null;
  const slot = (value: unknown): Bind | null | undefined => (value === undefined ? null : parseBind(value));
  const next = b.next !== undefined ? b.next : b.cycle;
  const named = [b.ptt, b.prev, next, b.overlay, b.wheel].map(slot);
  if (named.some((x) => x === undefined)) return null;
  return withBindDefaults({
    ptt: named[0] ?? null,
    prev: named[1] ?? null,
    next: named[2] ?? null,
    overlay: named[3] ?? null,
    wheel: named[4] ?? null,
    direct,
    select,
  });
}

export function parseOverlayState(raw: unknown): OverlayState | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<OverlayState>;
  if (typeof s.visible !== 'boolean' || !Array.isArray(s.speakers) || s.speakers.length > 32) return null;
  const speakers: OverlayState['speakers'] = [];
  for (const sp of s.speakers) {
    if (!sp || typeof sp.name !== 'string' || typeof sp.channel !== 'string' || typeof sp.freq !== 'string') return null;
    if (sp.name.length > 64 || sp.channel.length > 64 || sp.freq.length > 16) return null;
    speakers.push({ name: sp.name, channel: sp.channel, freq: sp.freq });
  }
  if (s.wheel === undefined) return { visible: s.visible, speakers };
  if (!s.wheel || typeof s.wheel !== 'object' || typeof s.wheel.open !== 'boolean') return null;
  if (JSON.stringify(s.wheel).length > 50_000) return null;
  return { visible: s.visible, speakers, wheel: s.wheel };
}

function finiteSteps(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 20;
}

export function parseWheelInput(raw: unknown): WheelInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const i = raw as WheelInput;
  switch (i.type) {
    case 'hover':
      if (i.index === null || (Number.isInteger(i.index) && i.index >= 0 && i.index < 64)) return { type: 'hover', index: i.index };
      return null;
    case 'left':
    case 'right':
      if (Number.isInteger(i.index) && i.index >= 0 && i.index < 64) return { type: i.type, index: i.index };
      return null;
    case 'scroll':
      if (!Number.isInteger(i.index) || i.index < 0 || i.index >= 64 || !finiteSteps(i.steps)) return null;
      return { type: 'scroll', index: i.index, steps: i.steps, shift: Boolean(i.shift) };
    case 'scroll-fallback':
      if (!finiteSteps(i.steps)) return null;
      return { type: 'scroll-fallback', steps: i.steps, shift: Boolean(i.shift) };
    case 'number':
      if (Number.isInteger(i.n) && i.n >= 1 && i.n <= 9) return { type: 'number', n: i.n };
      return null;
    case 'add-pick':
      if (typeof i.channelId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(i.channelId)) return { type: 'add-pick', channelId: i.channelId };
      return null;
    case 'add-create':
      if (typeof i.freq === 'string' && i.freq.length <= 32 && typeof i.name === 'string' && i.name.length <= 32) {
        return { type: 'add-create', freq: i.freq, name: i.name };
      }
      return null;
    case 'add-commit':
      if (typeof i.query === 'string' && i.query.length <= 64) return { type: 'add-commit', query: i.query };
      return null;
    case 'close':
      return { type: 'close' };
    default:
      return null;
  }
}

/** Log names are a short token. Details are truncated; the writer redacts secrets. */
export function parseLogEvent(event: unknown, detail: unknown): { event: string; detail?: string } | null {
  if (typeof event !== 'string' || !/^[a-z0-9:_-]{1,40}$/i.test(event)) return null;
  if (detail == null) return { event };
  if (typeof detail !== 'string') return null;
  return { event, detail: detail.slice(0, 300) };
}
