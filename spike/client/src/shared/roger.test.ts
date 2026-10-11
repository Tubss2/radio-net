import { describe, expect, it } from 'vitest';
import { clampHangMs, DEFAULT_HANG_MS, ReleaseTail, releaseTail, ROGER_MS } from './roger';

describe('release tail', () => {
  it('hangs, then plays the roger beep, at the default delay', () => {
    expect(clampHangMs(undefined)).toBe(DEFAULT_HANG_MS);
    expect(clampHangMs(200)).toBe(200);
    expect(clampHangMs(1000)).toBe(400);
    expect(clampHangMs(-20)).toBe(0);
    expect(clampHangMs(155)).toBe(160);
    expect(releaseTail({ hangMs: 200, roger: true })).toEqual([
      { waitMs: 200, roger: false },
      { waitMs: ROGER_MS, roger: true },
    ]);
  });

  it('skips the beep when roger is off, and skips the wait when the delay is zero', () => {
    expect(releaseTail({ hangMs: 200, roger: false })).toEqual([{ waitMs: 200, roger: false }]);
    expect(releaseTail({ hangMs: 0, roger: true })).toEqual([{ waitMs: ROGER_MS, roger: true }]);
    expect(releaseTail({ hangMs: 0, roger: false })).toEqual([]);
  });

  it('a new key-down during the hang cancels the mute', async () => {
    let pending: (() => void) | null = null;
    const tail = new ReleaseTail((ms) => new Promise((resolve) => { pending = resolve; void ms; }));
    const beeps: string[] = [];
    const run = tail.run({ hangMs: 200, roger: true }, () => beeps.push('roger'));
    await Promise.resolve();
    expect(tail.running).toBe(true);
    tail.cancel();
    pending?.();
    expect(await run).toBe('cancelled');
    expect(beeps).toEqual([]);
    expect(tail.running).toBe(false);
  });

  it('plays the beep only after the hang finishes', async () => {
    const waits: number[] = [];
    const tail = new ReleaseTail(async (ms) => { waits.push(ms); });
    const beeps: string[] = [];
    expect(await tail.run({ hangMs: 200, roger: true }, () => beeps.push('roger'))).toBe('done');
    expect(waits).toEqual([200, ROGER_MS]);
    expect(beeps).toEqual(['roger']);
  });
});
