import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_BINDS } from '../shared/keybinds';
import type { HotkeyEvent } from '../shared/types';

const hook = vi.hoisted(() => ({
  handlers: {} as Record<string, (e: { keycode: number }) => void>,
}));

vi.mock('uiohook-napi', () => ({
  UiohookKey: { Escape: 1 },
  WheelDirection: { VERTICAL: 3 },
  uIOhook: {
    on: (event: string, cb: (e: { keycode: number }) => void) => { hook.handlers[event] = cb; },
    start: () => undefined,
    stop: () => undefined,
  },
}));

import { Hotkeys } from './hotkeys';

describe('all-call key', () => {
  it('sends press and release for the all-call bind and ignores a repeat', () => {
    const events: HotkeyEvent[] = [];
    const hotkeys = new Hotkeys((event) => events.push(event));
    hotkeys.setBinds({ ...DEFAULT_BINDS, allCall: { kind: 'key', keycode: 34, label: 'G' } });
    hotkeys.start();
    hook.handlers.keydown({ keycode: 34 });
    hook.handlers.keydown({ keycode: 34 });
    hook.handlers.keyup({ keycode: 34 });
    expect(events).toEqual([
      { type: 'allcall', down: true },
      { type: 'allcall', down: false },
    ]);
  });
});
