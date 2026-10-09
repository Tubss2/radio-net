/** Mirrors spike/server/src/freq.ts. Frequencies are integer kHz (59.5 MHz -> 59500). */

export interface Band {
  minKHz: number;
  maxKHz: number;
  stepKHz: number;
}

/** Military VHF FM: 30.000–87.975 MHz, 25 kHz steps. */
export const DEFAULT_BAND: Band = { minKHz: 30_000, maxKHz: 87_975, stepKHz: 25 };

/** "59.5" | "59.500 MHz" | "59500" -> kHz, else null. */
export function parseFreqInput(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/\s*(mhz|m)$/, '');
  if (/^\d{4,6}$/.test(s)) return Number(s);
  if (!/^\d{1,3}(\.\d{1,3})?$/.test(s)) return null;
  const [w, f = ''] = s.split('.');
  return Number(w) * 1000 + Number(f.padEnd(3, '0'));
}

/** 59500 -> "59.500" */
export function formatFreqKHz(kHz: number): string {
  const sign = kHz < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(kHz));
  return `${sign}${Math.floor(abs / 1000)}.${String(abs % 1000).padStart(3, '0')}`;
}

/** Snap onto the band grid, then move by `steps` (negative lowers the frequency). Stays inside the band. */
export function stepFrequency(kHz: number, steps: number, band: Band = DEFAULT_BAND): number {
  const snapped = band.minKHz + Math.round((kHz - band.minKHz) / band.stepKHz) * band.stepKHz;
  const next = snapped + steps * band.stepKHz;
  return Math.min(band.maxKHz, Math.max(band.minKHz, next));
}
