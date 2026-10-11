import { describe, expect, it } from 'vitest';
import { clampHangMs, DEFAULT_HANG_MS, ReleaseTail, releaseTail } from './roger';

describe('release tail', () => {
  it('keeps the mic open for the release delay, and does not add a roger beep', () => {
    expect(clampHangMs(undefined)).toBe(DEFAULT_HANG_MS);
    expect(DEFAULT_HANG_MS).toBe(150);
    expect(clampHangMs(200)).toBe(200);
    expect(clampHangMs(1000)).toBe(400);
    expect(clampHangMs(-20)).toBe(0);
    expect(clampHangMs(155)).toBe(160);
    expect(releaseTail(150)).toEqual([{ waitMs: 150 }]);
    expect(releaseTail(0)).toEqual([]);
  });

  it('a new key-down during the hang cancels the mute', async () => {
    let pending: (() => void) | null = null;
    const tail = new ReleaseTail((ms) => new Promise((resolve) => { pending = resolve; void ms; }));
    const run = tail.run(200);
    await Promise.resolve();
    expect(tail.running).toBe(true);
    tail.cancel();
    pending?.();
    expect(await run).toBe('cancelled');
    expect(tail.running).toBe(false);
  });

  it('waits out the hang and then finishes', async () => {
    const waits: number[] = [];
    const tail = new ReleaseTail(async (ms) => { waits.push(ms); });
    expect(await tail.run(150)).toBe('done');
    expect(waits).toEqual([150]);
  });
});
