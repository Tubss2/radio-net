/** How long the mic stays open after the last talk source lets go. */
export const DEFAULT_HANG_MS = 200;
export const HANG_MIN_MS = 0;
export const HANG_MAX_MS = 400;
/** In-band beep after the hang, so listeners hear the end of the transmission. */
export const ROGER_MS = 180;

export function clampHangMs(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : DEFAULT_HANG_MS;
  const clamped = Math.min(HANG_MAX_MS, Math.max(HANG_MIN_MS, n));
  return Math.round(clamped / 10) * 10;
}

export interface TailStep {
  /** Keep the carrier up for this long. */
  waitMs: number;
  /** Start the roger beep at the beginning of this wait. The beep rides the still-open mic. */
  roger: boolean;
}

/**
 * After key-up: optional hang so the last word is not cut, then an optional roger beep,
 * then the caller mutes. A zero hang and no roger mutes immediately.
 */
export function releaseTail(opts: { hangMs: number; roger: boolean }): TailStep[] {
  const hang = clampHangMs(opts.hangMs);
  const steps: TailStep[] = [];
  if (hang > 0) steps.push({ waitMs: hang, roger: false });
  if (opts.roger) steps.push({ waitMs: ROGER_MS, roger: true });
  return steps;
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

  async run(opts: { hangMs: number; roger: boolean }, onRoger: () => void): Promise<'done' | 'cancelled'> {
    const mine = ++this.gen;
    this.running = true;
    try {
      for (const step of releaseTail(opts)) {
        if (mine !== this.gen) return 'cancelled';
        if (step.roger) onRoger();
        if (step.waitMs > 0) await this.sleep(step.waitMs);
      }
      if (mine !== this.gen) return 'cancelled';
      return 'done';
    } finally {
      if (mine === this.gen) this.running = false;
    }
  }
}
