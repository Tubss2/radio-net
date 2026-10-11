/** How long the mic stays open after the last talk source lets go. */
export const DEFAULT_HANG_MS = 150;
export const HANG_MIN_MS = 0;
export const HANG_MAX_MS = 400;

export function clampHangMs(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : DEFAULT_HANG_MS;
  const clamped = Math.min(HANG_MAX_MS, Math.max(HANG_MIN_MS, n));
  return Math.round(clamped / 10) * 10;
}

export interface TailStep {
  /** Keep the carrier up for this long. The end cue is local and does not extend it. */
  waitMs: number;
}

/**
 * After key-up, keep the mic open so the last word is not cut.
 * A zero delay mutes immediately. The end cue plays on the listener after this,
 * and is not mixed into the transmission.
 */
export function releaseTail(hangMs: number): TailStep[] {
  const hang = clampHangMs(hangMs);
  return hang > 0 ? [{ waitMs: hang }] : [];
}

/** Runs a release tail. `cancel` makes an in-flight run finish without muting. */
export class ReleaseTail {
  private gen = 0;
  running = false;

  constructor(private sleep: (ms: number) => Promise<void>) {}

  cancel() {
    this.gen += 1;
    this.running = false;
  }

  async run(hangMs: number): Promise<'done' | 'cancelled'> {
    const mine = ++this.gen;
    this.running = true;
    try {
      for (const step of releaseTail(hangMs)) {
        if (mine !== this.gen) return 'cancelled';
        if (step.waitMs > 0) await this.sleep(step.waitMs);
      }
      if (mine !== this.gen) return 'cancelled';
      return 'done';
    } finally {
      if (mine === this.gen) this.running = false;
    }
  }
}
