/**
 * Channel radial wheel behaviour. Pure: no DOM, no Electron.
 * The spike opens this on F2 (hold releases it, a short press latches until Esc or F2 again).
 * While it is open the wheel window takes mouse focus so clicks land on a segment.
 * Fallback, which does not need that focus: hold F2 and scroll or press 1–9. The global
 * hook delivers those, and they apply to the hovered segment, else the transmit segment.
 */
import { formatFreqKHz, parseFreqInput, stepFrequency, type Band } from './freq';

export const WHEEL_TAP_MS = 280;
export const VOLUME_STEP = 0.05;
export const VOLUME_MAX = 1.5;

export const WHEEL = { size: 560, cx: 280, cy: 280, inner: 132, outer: 250 };

/** uiohook keycodes for the top-row digits and the numpad (see uiohook-napi UiohookKey). */
const DIGIT_KEYCODES: Record<number, number> = {
  2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 7, 9: 8, 10: 9,
  79: 1, 80: 2, 81: 3, 75: 4, 76: 5, 77: 6, 71: 7, 72: 8, 73: 9,
};

export function digitFromKeycode(code: number): number | null {
  return DIGIT_KEYCODES[code] ?? null;
}

/** DOM KeyboardEvent.code: "Digit3" / "Numpad3". */
export function digitFromCode(code: string): number | null {
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(code);
  return m ? Number(m[1]) : null;
}

/**
 * Scroll delta -> notch count. Positive result raises frequency and volume.
 * DOM wheel deltaY is positive when the user scrolls down; uiohook rotation matches that sign.
 */
export function scrollSteps(delta: number): number {
  if (!Number.isFinite(delta) || delta === 0) return 0;
  const notches = Math.abs(delta) >= 40 ? Math.round(delta / 100) : Math.sign(delta);
  const n = notches === 0 ? Math.sign(delta) : notches;
  return -n;
}

export interface DialChannel {
  id: string;
  freqKHz: number;
  name: string;
}

/** Same match as the main tune box: exact frequency, exact name, or a unique name prefix. */
export function matchChannel(query: string, channels: DialChannel[]): DialChannel | null {
  const q = query.trim();
  if (!q) return null;
  const kHz = parseFreqInput(q);
  if (kHz != null) {
    const byFreq = channels.find((c) => c.freqKHz === kHz);
    if (byFreq) return byFreq;
  }
  const exact = channels.find((c) => c.name.toLowerCase() === q.toLowerCase());
  if (exact) return exact;
  const prefix = channels.filter((c) => c.name.toLowerCase().startsWith(q.toLowerCase()));
  return prefix.length === 1 ? prefix[0] : null;
}

export interface WheelSlot {
  freqKHz: number;
  channelId: string | null;
  volume: number;
  muted: boolean;
  canTransmit: boolean;
}

export interface WheelModel {
  slots: WheelSlot[];
  hover: number | null;
  adding: boolean;
  addError: string;
  volumeReveal: number | null;
}

export function emptyWheel(): WheelModel {
  return { slots: [], hover: null, adding: false, addError: '', volumeReveal: null };
}

export function slotsFromTuned(tuned: WheelSlot[]): WheelSlot[] {
  return [...tuned].sort((a, b) => a.freqKHz - b.freqKHz).map((s) => ({ ...s }));
}

export type WheelInput =
  | { type: 'hover'; index: number | null }
  | { type: 'left'; index: number }
  | { type: 'right'; index: number }
  | { type: 'scroll'; index: number; steps: number; shift: boolean }
  | { type: 'scroll-fallback'; steps: number; shift: boolean }
  | { type: 'number'; n: number }
  | { type: 'add-commit'; query: string }
  | { type: 'close' };

export type WheelIntent =
  | { type: 'set-tx'; channelId: string }
  | { type: 'set-muted'; channelId: string; muted: boolean }
  | { type: 'set-volume'; channelId: string; volume: number }
  | { type: 'tune'; channelId: string }
  | { type: 'untune'; channelId: string };

export interface WheelSegmentView {
  kind: 'channel' | 'add';
  label: string;
  freq: string | null;
  name: string;
  live: boolean;
  transmitting: boolean;
  muted: boolean;
  volume: number;
  showVolume: boolean;
  hovered: boolean;
  empty: boolean;
}

export function onWheelKey(
  state: { open: boolean; latched: boolean; adding: boolean },
  ev: { down: boolean; heldMs: number },
): { open: boolean; latched: boolean } {
  // The add field needs the keyboard, so the wheel key must not dismiss it.
  if (state.adding) return { open: true, latched: true };
  if (ev.down) {
    if (state.open && state.latched) return { open: false, latched: false };
    return { open: true, latched: false };
  }
  if (!state.open) return { open: false, latched: false };
  if (ev.heldMs < WHEEL_TAP_MS) return { open: true, latched: true };
  return { open: false, latched: false };
}

/** Segment 0 is centred on 12 o'clock; the rest run clockwise. */
export function segmentAngles(count: number, start?: number) {
  const sweep = (Math.PI * 2) / count;
  const a0s = start ?? (-Math.PI / 2 - sweep / 2);
  return Array.from({ length: count }, (_, i) => {
    const a0 = a0s + i * sweep;
    return { a0, a1: a0 + sweep, mid: a0 + sweep / 2 };
  });
}

export function polar(cx: number, cy: number, r: number, a: number) {
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

export function segmentPath(cx: number, cy: number, inner: number, outer: number, a0: number, a1: number) {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const o0 = polar(cx, cy, outer, a0);
  const o1 = polar(cx, cy, outer, a1);
  const i1 = polar(cx, cy, inner, a1);
  const i0 = polar(cx, cy, inner, a0);
  return `M ${o0.x} ${o0.y} A ${outer} ${outer} 0 ${large} 1 ${o1.x} ${o1.y} L ${i1.x} ${i1.y} A ${inner} ${inner} 0 ${large} 0 ${i0.x} ${i0.y} Z`;
}

export function labelPoint(index: number, count: number, geom = WHEEL) {
  const { mid } = segmentAngles(count)[index];
  const r = (geom.inner + geom.outer) / 2;
  return { ...polar(geom.cx, geom.cy, r, mid), mid };
}

/** Ring hit test. The middle of segment 0 is 12 o'clock, then clockwise. The hole and the outside miss. */
export function hitTest(x: number, y: number, geom: typeof WHEEL = WHEEL, count: number): number | null {
  if (count <= 0) return null;
  const dx = x - geom.cx;
  const dy = y - geom.cy;
  const r = Math.hypot(dx, dy);
  if (r < geom.inner || r > geom.outer) return null;
  const tau = Math.PI * 2;
  const sweep = tau / count;
  let a = Math.atan2(dy, dx) - (-Math.PI / 2) + sweep / 2;
  a = ((a % tau) + tau) % tau;
  return Math.min(count - 1, Math.floor(a / sweep));
}

function clampVolume(v: number) {
  return Math.min(VOLUME_MAX, Math.max(0, Math.round(v * 100) / 100));
}

function othersUse(slots: WheelSlot[], channelId: string, except: number) {
  return slots.some((s, i) => i !== except && s.channelId === channelId);
}

/** Hovered channel segment, else the transmit segment, else the first. The add segment is never the fallback. */
export function scrollTarget(model: WheelModel, txId: string | null): number | null {
  if (model.hover != null && model.hover >= 0 && model.hover < model.slots.length) return model.hover;
  const tx = model.slots.findIndex((s) => s.channelId != null && s.channelId === txId);
  if (tx >= 0) return tx;
  return model.slots.length ? 0 : null;
}

function scrollSlot(model: WheelModel, index: number, steps: number, shift: boolean, channels: DialChannel[], band?: Band): { model: WheelModel; intents: WheelIntent[] } {
  const slot = model.slots[index];
  if (!slot || steps === 0) return { model, intents: [] };
  const slots = model.slots.slice();
  if (shift) {
    const volume = clampVolume(slot.volume + steps * VOLUME_STEP);
    slots[index] = { ...slot, volume };
    const intents: WheelIntent[] = slot.channelId ? [{ type: 'set-volume', channelId: slot.channelId, volume }] : [];
    return { model: { ...model, slots, volumeReveal: index }, intents };
  }
  const freqKHz = stepFrequency(slot.freqKHz, steps, band);
  if (freqKHz === slot.freqKHz) return { model, intents: [] };
  const match = channels.find((c) => c.freqKHz === freqKHz) ?? null;
  if (match && othersUse(slots, match.id, index)) return { model, intents: [] };
  const intents: WheelIntent[] = [];
  if (slot.channelId && slot.channelId !== match?.id && !othersUse(model.slots, slot.channelId, index)) {
    intents.push({ type: 'untune', channelId: slot.channelId });
  }
  if (match && match.id !== slot.channelId) intents.push({ type: 'tune', channelId: match.id });
  slots[index] = { ...slot, freqKHz, channelId: match?.id ?? null, canTransmit: match ? true : slot.canTransmit };
  return { model: { ...model, slots, volumeReveal: null }, intents };
}

export function applyWheelInput(model: WheelModel, input: WheelInput, channels: DialChannel[], txId: string | null = null): { model: WheelModel; intents: WheelIntent[] } {
  if (input.type === 'hover') return { model: { ...model, hover: input.index }, intents: [] };
  if (input.type === 'close') return { model: { ...model, adding: false, addError: '', hover: null, volumeReveal: null }, intents: [] };
  if (input.type === 'scroll-fallback') {
    const index = scrollTarget(model, txId);
    if (index == null) return { model, intents: [] };
    return scrollSlot(model, index, input.steps, input.shift, channels);
  }
  if (input.type === 'number') return applyWheelInput(model, { type: 'left', index: input.n - 1 }, channels, txId);
  if (input.type === 'scroll') {
    if (input.index < 0 || input.index >= model.slots.length) return { model, intents: [] };
    return scrollSlot(model, input.index, input.steps, input.shift, channels);
  }
  if (input.type === 'right') {
    const slot = model.slots[input.index];
    if (!slot) return { model, intents: [] };
    const slots = model.slots.slice();
    const muted = !slot.muted;
    slots[input.index] = { ...slot, muted };
    const intents: WheelIntent[] = slot.channelId ? [{ type: 'set-muted', channelId: slot.channelId, muted }] : [];
    return { model: { ...model, slots }, intents };
  }
  if (input.type === 'left') {
    if (input.index === model.slots.length) return { model: { ...model, adding: true, addError: '', hover: input.index }, intents: [] };
    const slot = model.slots[input.index];
    if (!slot?.channelId || !slot.canTransmit) return { model: { ...model, hover: input.index }, intents: [] };
    return { model: { ...model, hover: input.index }, intents: [{ type: 'set-tx', channelId: slot.channelId }] };
  }
  const hit = matchChannel(input.query, channels);
  if (!hit) return { model: { ...model, addError: input.query.trim() ? `No channel matches “${input.query.trim()}”` : 'Type a frequency or name' }, intents: [] };
  const existing = model.slots.findIndex((s) => s.channelId === hit.id);
  if (existing >= 0) return { model: { ...model, adding: false, addError: '', hover: existing }, intents: [] };
  const slots = [...model.slots, { freqKHz: hit.freqKHz, channelId: hit.id, volume: 1, muted: false, canTransmit: true }];
  return { model: { ...model, slots, adding: false, addError: '', hover: slots.length - 1 }, intents: [{ type: 'tune', channelId: hit.id }] };
}

export function buildSegments(model: WheelModel, meta: (slot: WheelSlot, index: number) => { name: string; live: boolean; transmitting: boolean }): WheelSegmentView[] {
  const segments: WheelSegmentView[] = model.slots.map((slot, index) => {
    const m = meta(slot, index);
    return {
      kind: 'channel',
      label: `CH${index + 1}`,
      freq: formatFreqKHz(slot.freqKHz),
      name: slot.channelId ? m.name : '',
      live: Boolean(slot.channelId) && m.live && !slot.muted,
      transmitting: Boolean(slot.channelId) && m.transmitting,
      muted: slot.muted,
      volume: slot.volume,
      showVolume: model.volumeReveal === index || model.hover === index,
      hovered: model.hover === index,
      empty: !slot.channelId,
    };
  });
  segments.push({
    kind: 'add',
    label: '+',
    freq: null,
    name: '',
    live: false,
    transmitting: false,
    muted: false,
    volume: 1,
    showVolume: false,
    hovered: model.hover === model.slots.length,
    empty: false,
  });
  return segments;
}
