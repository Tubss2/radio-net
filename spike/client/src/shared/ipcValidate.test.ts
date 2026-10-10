import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDS, UIO_G } from './keybinds';
import { parseKeybinds, parseLogEvent, parseOverlayState, parseWheelInput } from './ipcValidate';

describe('IPC validation', () => {
  it('accepts the default binds and rejects a forged payload', () => {
    expect(parseKeybinds(DEFAULT_BINDS)?.ptt).toEqual(DEFAULT_BINDS.ptt);
    expect(parseKeybinds(DEFAULT_BINDS)?.prev).toEqual(DEFAULT_BINDS.prev);
    expect(parseKeybinds(DEFAULT_BINDS)?.allCall).toBeNull();
    expect(parseKeybinds({ allCall: { kind: 'key', keycode: UIO_G, label: 'G' } })?.allCall).toMatchObject({ keycode: UIO_G, label: 'G' });
    expect(parseKeybinds({ allCall: { kind: 'key', keycode: -1, label: 'nope' } })).toBeNull();
    expect(parseKeybinds({
      ptt: { kind: 'key', keycode: 34, label: 'G' },
      cycle: { kind: 'mouse', button: 5, label: 'Mouse 5' },
    })?.next).toMatchObject({ kind: 'mouse', button: 5 });
    expect(parseKeybinds({ ptt: { kind: 'key', keycode: -1, label: 'nope' } })).toBeNull();
    expect(parseKeybinds({ ptt: { kind: 'key', keycode: 1, label: 'x'.repeat(40) } })).toBeNull();
    expect(parseKeybinds({ direct: { '../x': { kind: 'mouse', button: 4, label: 'Mouse 4' } } })).toBeNull();
  });

  it('caps overlay speakers and drops a non-object', () => {
    expect(parseOverlayState({ visible: true, speakers: [{ name: 'Toby', channel: 'Command', freq: '59.5' }] })?.speakers).toHaveLength(1);
    expect(parseOverlayState({ visible: true, speakers: [{ name: 'x'.repeat(80), channel: 'c', freq: '1' }] })).toBeNull();
    expect(parseOverlayState(null)).toBeNull();
  });

  it('accepts wheel clicks and rejects odd types', () => {
    expect(parseWheelInput({ type: 'left', index: 2 })).toEqual({ type: 'left', index: 2 });
    expect(parseWheelInput({ type: 'add-pick', channelId: '../etc' })).toBeNull();
    expect(parseWheelInput({ type: 'nope' })).toBeNull();
  });

  it('rejects log events that are not a short name', () => {
    expect(parseLogEvent('livekit', 'connected 59.5')).toEqual({ event: 'livekit', detail: 'connected 59.5' });
    expect(parseLogEvent('Bearer abc', 'x')).toBeNull();
    expect(parseLogEvent('ok', 12)).toBeNull();
  });
});
