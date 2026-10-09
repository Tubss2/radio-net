import { describe, expect, it } from 'vitest';
import { formatFreqKHz, stepFrequency } from './freq';
import {
  WHEEL,
  applyWheelInput,
  availableChannels,
  buildSegments,
  digitFromCode,
  digitFromKeycode,
  emptyWheel,
  duplicateWheelNotch,
  hitTest,
  hookScrollReachesPage,
  hookShouldEmitScroll,
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
  it('holds the wheel key to show it, a short press latches, release or a second press closes, and the add field keeps it up', () => {
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
    // A jump that would have landed on Command used to be discarded, which pinned the dial.
    // The notch skips that frequency and keeps going.
    const skipped = applyWheelInput(base(), { type: 'scroll', index: 0, steps: (59500 - 41500) / 500, shift: false }, channels);
    expect(skipped.model.slots[0]).toMatchObject({ freqKHz: 60000, channelId: null });
    expect(skipped.model.slots[1].channelId).toBe('cmd');
    expect(skipped.intents).toEqual([{ type: 'untune', channelId: 'arty' }]);
    const rail = applyWheelInput(model([slot({ freqKHz: 87500, channelId: null })]), { type: 'scroll', index: 0, steps: 1, shift: false }, channels);
    expect(rail.model.slots[0].freqKHz).toBe(87500);
  });

  it('scrolls the full 30.0–87.5 grid, skipping a frequency another segment is tuned to', () => {
    const nets = [...channels, { id: 'bravo', freqKHz: 62500, name: 'Bravo FT' }];
    const crowded = model([
      slot({ freqKHz: 62000, channelId: 'alpha' }),
      slot({ freqKHz: 62500, channelId: 'bravo' }),
    ]);
    // Adjacent nets: one notch used to do nothing, so the dial looked stuck on the channel.
    const up = applyWheelInput(crowded, { type: 'scroll', index: 0, steps: 1, shift: false }, nets);
    expect(up.model.slots[0]).toMatchObject({ freqKHz: 63000, channelId: null });
    expect(up.model.slots[1]).toMatchObject({ freqKHz: 62500, channelId: 'bravo' });
    expect(up.intents).toEqual([{ type: 'untune', channelId: 'alpha' }]);
    const down = applyWheelInput(crowded, { type: 'scroll', index: 1, steps: -1, shift: false }, nets);
    expect(down.model.slots[1]).toMatchObject({ freqKHz: 61500, channelId: null });
    expect(down.intents).toEqual([{ type: 'untune', channelId: 'bravo' }]);

    const tuned = model([
      slot({ freqKHz: 41500, channelId: 'arty' }),
      slot({ freqKHz: 30000, channelId: null }),
      slot({ freqKHz: 59500, channelId: 'cmd' }),
    ]);
    const reserved = new Set([41500, 59500]);
    let m = tuned;
    let freq = 30000;
    const seen = [freq];
    while (freq < 87500) {
      const next = applyWheelInput(m, { type: 'scroll', index: 1, steps: 1, shift: false }, nets);
      const landed = next.model.slots[1].freqKHz;
      expect(landed).toBeGreaterThan(freq);
      expect(reserved.has(landed)).toBe(false);
      expect(next.model.slots[0].freqKHz).toBe(41500);
      expect(next.model.slots[2].freqKHz).toBe(59500);
      freq = landed;
      seen.push(freq);
      m = next.model;
      expect(seen.length).toBeLessThan(200);
    }
    expect(freq).toBe(87500);
    expect(seen).toContain(41000);
    expect(seen).toContain(42000);
    expect(seen).toContain(59000);
    expect(seen).toContain(60000);
    expect(seen).not.toContain(41500);
    expect(seen).not.toContain(59500);

    const parked = model([
      slot({ freqKHz: 87000, channelId: null }),
      slot({ freqKHz: 87500, channelId: 'air' }),
    ]);
    const edge = applyWheelInput(parked, { type: 'scroll', index: 0, steps: 5, shift: false }, [{ id: 'air', freqKHz: 87500, name: 'Air' }]);
    expect(edge.model.slots[0].freqKHz).toBe(87000);
    expect(edge.model.slots[1].channelId).toBe('air');
    expect(edge.intents).toEqual([]);
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

  it('the add list offers channels that are not tuned, and picking one tunes it', () => {
    const open = model([slot({ freqKHz: 41500, channelId: 'arty' }), slot({ freqKHz: 59500, channelId: 'cmd' })], { adding: true });
    expect(availableChannels(channels, open.slots).map((c) => c.id)).toEqual(['logi', 'alpha']);
    const picked = applyWheelInput(open, { type: 'add-pick', channelId: 'alpha' }, channels);
    expect(picked.model.slots.map((s) => s.channelId)).toEqual(['arty', 'cmd', 'alpha']);
    expect(picked.intents).toEqual([{ type: 'tune', channelId: 'alpha' }]);
    expect(picked.model.adding).toBe(false);
    const again = applyWheelInput(picked.model, { type: 'add-pick', channelId: 'cmd' }, channels);
    expect(again.model.slots).toHaveLength(3);
    expect(again.intents).toEqual([]);
    expect(again.model.hover).toBe(1);
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

describe('scroll before the wheel window is focused', () => {
  it('reports hook notches the whole time the wheel is open, and only once', () => {
    expect(hookShouldEmitScroll({ wheelOpen: true, wheelKeyHeld: false })).toBe(true);
    expect(hookShouldEmitScroll({ wheelOpen: false, wheelKeyHeld: true })).toBe(true);
    expect(hookShouldEmitScroll({ wheelOpen: false, wheelKeyHeld: false })).toBe(false);
    // Foreground and accepting the mouse: the page gets WM_MOUSEWHEEL.
    expect(hookScrollReachesPage({ focused: true, ignoringMouse: false })).toBe(true);
    // Focused but click-through: forward does not include the wheel.
    expect(hookScrollReachesPage({ focused: true, ignoringMouse: true })).toBe(false);
    // The game kept focus.
    expect(hookScrollReachesPage({ focused: false, ignoringMouse: false })).toBe(false);
    const page = { at: 1000, steps: 1, shift: false, source: 'page' as const };
    const hook = { at: 1020, steps: 1, shift: false, source: 'hook' as const };
    expect(duplicateWheelNotch(page, hook)).toBe(true);
    expect(duplicateWheelNotch(hook, page)).toBe(true);
    expect(duplicateWheelNotch(page, { ...hook, at: 1100 })).toBe(false);
    expect(duplicateWheelNotch(page, { ...page, at: 1010 })).toBe(false);
    expect(duplicateWheelNotch(null, hook)).toBe(false);
    expect(duplicateWheelNotch(page, { ...hook, shift: true })).toBe(false);
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
