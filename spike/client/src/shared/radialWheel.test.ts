import { describe, expect, it } from 'vitest';
import { formatFreqKHz, stepFrequency } from './freq';
import {
  WHEEL,
  applyWheelInput,
  buildSegments,
  digitFromCode,
  digitFromKeycode,
  emptyWheel,
  hitTest,
  labelPoint,
  matchChannel,
  onWheelKey,
  scrollSteps,
  slotsFromTuned,
  type DialChannel,
  type WheelModel,
  type WheelSlot,
} from './radialWheel';

const channels: DialChannel[] = [
  { id: 'cmd', freqKHz: 59500, name: 'Command' },
  { id: 'arty', freqKHz: 41500, name: 'Arty' },
  { id: 'logi', freqKHz: 45000, name: 'Logi' },
  { id: 'alpha', freqKHz: 62000, name: 'Alpha FT' },
];

function slot(partial: Partial<WheelSlot> & Pick<WheelSlot, 'freqKHz' | 'channelId'>): WheelSlot {
  return { volume: 1, muted: false, canTransmit: true, ...partial };
}

function model(slots: WheelSlot[], extra: Partial<WheelModel> = {}): WheelModel {
  return { ...emptyWheel(), slots, ...extra };
}

describe('frequency steps', () => {
  it('moves in 0.5 MHz steps and stays inside 30.0–87.5', () => {
    expect(stepFrequency(59500, 1)).toBe(60000);
    expect(stepFrequency(59500, -1)).toBe(59000);
    expect(stepFrequency(30000, -1)).toBe(30000);
    expect(stepFrequency(87500, 1)).toBe(87500);
    expect(stepFrequency(87000, 1)).toBe(87500);
    expect(formatFreqKHz(59500)).toBe('59.5');
    expect(formatFreqKHz(50500)).toBe('50.5');
    expect(formatFreqKHz(50000)).toBe('50.0');
  });

  it('snaps an off-grid frequency onto the step before moving', () => {
    expect(stepFrequency(59510, 1)).toBe(60000);
    expect(stepFrequency(59510, 0)).toBe(59500);
  });
});

describe('scroll notches', () => {
  it('treats scroll-up as a positive step for both DOM pixels and hook rotation', () => {
    expect(scrollSteps(-100)).toBe(1);
    expect(scrollSteps(100)).toBe(-1);
    expect(scrollSteps(-1)).toBe(1);
    expect(scrollSteps(1)).toBe(-1);
    expect(scrollSteps(0)).toBe(0);
  });
});

describe('hit testing', () => {
  const at = (deg: number, radius: number) => {
    const a = (deg * Math.PI) / 180;
    return { x: WHEEL.cx + radius * Math.cos(a), y: WHEEL.cy + radius * Math.sin(a) };
  };
  const mid = (WHEEL.inner + WHEEL.outer) / 2;

  it('maps the ring clockwise from 12 o’clock and misses the hole and the outside', () => {
    expect(hitTest(at(-90, mid).x, at(-90, mid).y, WHEEL, 4)).toBe(0);
    expect(hitTest(at(0, mid).x, at(0, mid).y, WHEEL, 4)).toBe(1);
    expect(hitTest(at(90, mid).x, at(90, mid).y, WHEEL, 4)).toBe(2);
    expect(hitTest(at(180, mid).x, at(180, mid).y, WHEEL, 4)).toBe(3);
    expect(hitTest(WHEEL.cx, WHEEL.cy, WHEEL, 4)).toBeNull();
    expect(hitTest(at(0, WHEEL.outer + 20).x, at(0, WHEEL.outer + 20).y, WHEEL, 4)).toBeNull();
  });

  it('centres the first segment on 12 o’clock', () => {
    const p = labelPoint(0, 4);
    expect(p.y).toBeLessThan(WHEEL.cy - 40);
    expect(Math.abs(p.x - WHEEL.cx)).toBeLessThan(1);
  });

  it('treats a single add segment as the whole ring', () => {
    expect(hitTest(at(30, mid).x, at(30, mid).y, WHEEL, 1)).toBe(0);
  });
});

describe('channel match', () => {
  it('resolves a frequency, an exact name, or a unique prefix', () => {
    expect(matchChannel('59.5', channels)?.id).toBe('cmd');
    expect(matchChannel('59.500 MHz', channels)?.id).toBe('cmd');
    expect(matchChannel('command', channels)?.id).toBe('cmd');
    expect(matchChannel('art', channels)?.id).toBe('arty');
    expect(matchChannel('a', channels)).toBeNull();
    expect(matchChannel('nope', channels)).toBeNull();
    expect(matchChannel('  ', channels)).toBeNull();
  });
});

describe('opening the wheel', () => {
  it('holds G to show it, a short press latches, release or a second press closes, and the add field keeps it up', () => {
    let s = { open: false, latched: false, adding: false };
    s = { ...s, ...onWheelKey(s, { down: true, heldMs: 0 }) };
    expect(s).toMatchObject({ open: true, latched: false });
    expect(onWheelKey(s, { down: false, heldMs: 40 })).toMatchObject({ open: true, latched: true });
    expect(onWheelKey({ open: true, latched: true, adding: false }, { down: true, heldMs: 0 })).toMatchObject({ open: false, latched: false });
    expect(onWheelKey({ open: true, latched: false, adding: false }, { down: false, heldMs: 600 })).toMatchObject({ open: false, latched: false });
    expect(onWheelKey({ open: true, latched: false, adding: true }, { down: false, heldMs: 900 })).toMatchObject({ open: true, latched: true });
    expect(onWheelKey({ open: false, latched: false, adding: false }, { down: false, heldMs: 50 })).toMatchObject({ open: false });
  });

  it('orders tuned channels by frequency for CH1 at the top', () => {
    const slots = slotsFromTuned([
      slot({ freqKHz: 59500, channelId: 'cmd' }),
      slot({ freqKHz: 41500, channelId: 'arty' }),
    ]);
    expect(slots.map((s) => s.channelId)).toEqual(['arty', 'cmd']);
  });
});

describe('wheel actions', () => {
  const base = () => model([
    slot({ freqKHz: 41500, channelId: 'arty' }),
    slot({ freqKHz: 59500, channelId: 'cmd' }),
  ]);

  it('left-click sets the transmit channel and the number keys do the same', () => {
    expect(applyWheelInput(base(), { type: 'left', index: 1 }, channels).intents).toEqual([{ type: 'set-tx', channelId: 'cmd' }]);
    expect(applyWheelInput(base(), { type: 'number', n: 1 }, channels).intents).toEqual([{ type: 'set-tx', channelId: 'arty' }]);
    const quiet = model([slot({ freqKHz: 41500, channelId: 'arty', canTransmit: false })]);
    expect(applyWheelInput(quiet, { type: 'left', index: 0 }, channels).intents).toEqual([]);
  });

  it('right-click toggles mute and greys that slot', () => {
    const once = applyWheelInput(base(), { type: 'right', index: 0 }, channels);
    expect(once.intents).toEqual([{ type: 'set-muted', channelId: 'arty', muted: true }]);
    expect(once.model.slots[0].muted).toBe(true);
    const twice = applyWheelInput(once.model, { type: 'right', index: 0 }, channels);
    expect(twice.model.slots[0].muted).toBe(false);
    const view = buildSegments(once.model, () => ({ name: 'Arty', live: true, transmitting: false }));
    expect(view[0]).toMatchObject({ label: 'CH1', muted: true, live: false });
  });

  it('scroll steps frequency, leaves the channel when nothing is on the new freq, and will not stack two slots', () => {
    const up = applyWheelInput(base(), { type: 'scroll', index: 1, steps: 1, shift: false }, channels);
    expect(up.model.slots[1].freqKHz).toBe(60000);
    expect(up.model.slots[1].channelId).toBeNull();
    expect(up.intents).toEqual([{ type: 'untune', channelId: 'cmd' }]);
    const onto = applyWheelInput(base(), { type: 'scroll', index: 0, steps: 1, shift: false }, channels);
    expect(onto.model.slots[0]).toMatchObject({ freqKHz: 42000, channelId: null });
    const blocked = applyWheelInput(base(), { type: 'scroll', index: 0, steps: (59500 - 41500) / 500, shift: false }, channels);
    expect(blocked.model.slots[0].channelId).toBe('arty');
    expect(blocked.intents).toEqual([]);
    const rail = applyWheelInput(model([slot({ freqKHz: 87500, channelId: null })]), { type: 'scroll', index: 0, steps: 1, shift: false }, channels);
    expect(rail.model.slots[0].freqKHz).toBe(87500);
  });

  it('shift-scroll changes volume, clamps it, and reveals the bar', () => {
    const up = applyWheelInput(base(), { type: 'scroll', index: 1, steps: 2, shift: true }, channels);
    expect(up.model.slots[1].volume).toBe(1.1);
    expect(up.model.volumeReveal).toBe(1);
    expect(up.intents).toEqual([{ type: 'set-volume', channelId: 'cmd', volume: 1.1 }]);
    const capped = applyWheelInput(model([slot({ freqKHz: 59500, channelId: 'cmd', volume: 1.5 })]), { type: 'scroll', index: 0, steps: 3, shift: true }, channels);
    expect(capped.model.slots[0].volume).toBe(1.5);
    const floor = applyWheelInput(model([slot({ freqKHz: 59500, channelId: 'cmd', volume: 0.05 })]), { type: 'scroll', index: 0, steps: -4, shift: true }, channels);
    expect(floor.model.slots[0].volume).toBe(0);
  });

  it('fallback scroll and number keys hit the transmit segment when nothing is hovered', () => {
    const m = base();
    const scrolled = applyWheelInput(m, { type: 'scroll-fallback', steps: -1, shift: false }, channels, 'cmd');
    expect(scrolled.model.slots[1].freqKHz).toBe(59000);
    const hovered = applyWheelInput({ ...m, hover: 0 }, { type: 'scroll-fallback', steps: 1, shift: false }, channels, 'cmd');
    expect(hovered.model.slots[0].freqKHz).toBe(42000);
  });

  it('the add segment tunes by frequency or name and ignores scroll', () => {
    const opened = applyWheelInput(base(), { type: 'left', index: 2 }, channels);
    expect(opened.model.adding).toBe(true);
    expect(applyWheelInput(opened.model, { type: 'scroll', index: 2, steps: 1, shift: false }, channels).intents).toEqual([]);
    const added = applyWheelInput(opened.model, { type: 'add-commit', query: 'logi' }, channels);
    expect(added.model.slots.map((s) => s.channelId)).toEqual(['arty', 'cmd', 'logi']);
    expect(added.intents).toEqual([{ type: 'tune', channelId: 'logi' }]);
    expect(added.model.adding).toBe(false);
    const missing = applyWheelInput(opened.model, { type: 'add-commit', query: 'nope' }, channels);
    expect(missing.model.addError).toMatch(/No channel matches/);
    expect(missing.intents).toEqual([]);
    const again = applyWheelInput(added.model, { type: 'add-commit', query: '59.5' }, channels);
    expect(again.model.slots).toHaveLength(3);
    expect(again.model.hover).toBe(1);
  });

  it('builds a ring: channel labels, the transmit speaker, a muted segment, and a radio add slice', () => {
    const muted = model([
      slot({ freqKHz: 41500, channelId: 'arty' }),
      slot({ freqKHz: 59500, channelId: 'cmd' }),
      slot({ freqKHz: 62000, channelId: 'alpha', muted: true }),
    ], { hover: 0 });
    const view = buildSegments(muted, (s) => ({
      name: channels.find((c) => c.id === s.channelId)?.name ?? '',
      live: true,
      transmitting: s.channelId === 'cmd',
    }));
    expect(view.map((s) => s.label)).toEqual(['CH1', 'CH2', 'CH3', '+']);
    expect(view[0]).toMatchObject({ freq: '41.5', name: 'Arty', live: true, showVolume: true, hovered: true });
    expect(view[1]).toMatchObject({ transmitting: true, name: 'Command' });
    expect(view[2]).toMatchObject({ muted: true, live: false, name: 'Alpha FT' });
    expect(view[3].kind).toBe('add');
    expect(view).toHaveLength(4);
  });
});

describe('a wheel session', () => {
  it('selects, mutes, retunes, changes volume, adds, then closes', () => {
    let m = model(slotsFromTuned([
      slot({ freqKHz: 59500, channelId: 'cmd' }),
      slot({ freqKHz: 41500, channelId: 'arty' }),
    ]));
    m = applyWheelInput(m, { type: 'hover', index: 0 }, channels).model;
    const tx = applyWheelInput(m, { type: 'left', index: 0 }, channels);
    expect(tx.intents).toEqual([{ type: 'set-tx', channelId: 'arty' }]);
    const muted = applyWheelInput(tx.model, { type: 'right', index: 0 }, channels);
    expect(muted.model.slots[0].muted).toBe(true);
    const vol = applyWheelInput(muted.model, { type: 'scroll', index: 0, steps: -2, shift: true }, channels);
    expect(vol.model.slots[0].volume).toBe(0.9);
    expect(vol.model.volumeReveal).toBe(0);
    const dial = applyWheelInput(vol.model, { type: 'scroll', index: 1, steps: 1, shift: false }, channels);
    expect(dial.model.slots[1]).toMatchObject({ freqKHz: 60000, channelId: null });
    const adding = applyWheelInput(dial.model, { type: 'left', index: dial.model.slots.length }, channels);
    expect(adding.model.adding).toBe(true);
    const added = applyWheelInput(adding.model, { type: 'add-commit', query: '45.000' }, channels);
    expect(added.model.slots.map((s) => s.channelId)).toEqual(['arty', null, 'logi']);
    expect(added.intents).toEqual([{ type: 'tune', channelId: 'logi' }]);
    const closed = applyWheelInput(added.model, { type: 'close' }, channels);
    expect(closed.model.adding).toBe(false);
    expect(closed.model.hover).toBeNull();
    expect(closed.model.slots).toHaveLength(3);
    expect(onWheelKey({ open: true, latched: true, adding: false }, { down: true, heldMs: 0 }).open).toBe(false);
  });
});

describe('fallback digits', () => {
  it('reads the top row and the numpad, and DOM codes', () => {
    expect(digitFromKeycode(2)).toBe(1);
    expect(digitFromKeycode(10)).toBe(9);
    expect(digitFromKeycode(79)).toBe(1);
    expect(digitFromKeycode(73)).toBe(9);
    expect(digitFromKeycode(11)).toBeNull();
    expect(digitFromCode('Digit4')).toBe(4);
    expect(digitFromCode('Numpad8')).toBe(8);
    expect(digitFromCode('KeyG')).toBeNull();
  });
});
