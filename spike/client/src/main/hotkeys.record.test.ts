import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('uiohook-napi', () => ({
  UiohookKey: { Escape: 1 },
  WheelDirection: { VERTICAL: 3 },
  uIOhook: { on: () => undefined, start: () => undefined, stop: () => undefined },
}));

import { Hotkeys } from './hotkeys';

describe('bind recorder', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps one recording and clears it after ten seconds', async () => {
    vi.useFakeTimers();
    const hotkeys = new Hotkeys(() => undefined);
    const first = hotkeys.record(10_000);
    const second = hotkeys.record(10_000);
    await expect(first).resolves.toBeNull();
    vi.advanceTimersByTime(9_999);
    let settled = false;
    const done = second.then((value) => {
      settled = true;
      return value;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    vi.advanceTimersByTime(1);
    await expect(done).resolves.toBeNull();
  });
});
