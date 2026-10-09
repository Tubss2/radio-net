/** Mirrors spike/server/src/freq.ts. Frequencies are integer kHz (50.5 MHz -> 50500). */

export interface Band {
  minKHz: number;
  maxKHz: number;
  stepKHz: number;
}

/** 30.0–87.5 MHz, 0.5 MHz steps. */
export const DEFAULT_BAND: Band = { minKHz: 30_000, maxKHz: 87_500, stepKHz: 500 };

/** "50.5" | "50.500 MHz" | "50500" -> kHz, else null. */
export function parseFreqInput(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/\s*(mhz|m)$/, '');
  if (/^\d{4,6}$/.test(s)) return Number(s);
  if (!/^\d{1,3}(\.\d{1,3})?$/.test(s)) return null;
  const [w, f = ''] = s.split('.');
  return Number(w) * 1000 + Number(f.padEnd(3, '0'));
}

/** 50500 -> "50.5", 50000 -> "50.0". One decimal place. */
export function formatFreqKHz(kHz: number): string {
  const negative = kHz < 0;
  const scaled = Math.round(Math.abs(kHz) / 100);
  const text = `${Math.floor(scaled / 10)}.${scaled % 10}`;
  return negative ? `-${text}` : text;
}

export function validateFrequency(kHz: number, band: Band = DEFAULT_BAND): string | null {
  if (!Number.isInteger(kHz)) return 'Frequency must be a whole number of kHz';
  if (kHz < band.minKHz || kHz > band.maxKHz)
    return `Frequency must be between ${formatFreqKHz(band.minKHz)} and ${formatFreqKHz(band.maxKHz)} MHz`;
  if ((kHz - band.minKHz) % band.stepKHz !== 0)
    return `Frequency must be in ${band.stepKHz / 1000} MHz steps`;
  return null;
}

/** Snap onto the band grid, then move by `steps` (negative lowers the frequency). Stays inside the band. */
export function stepFrequency(kHz: number, steps: number, band: Band = DEFAULT_BAND): number {
  const snapped = band.minKHz + Math.round((kHz - band.minKHz) / band.stepKHz) * band.stepKHz;
  const next = snapped + steps * band.stepKHz;
  return Math.min(band.maxKHz, Math.max(band.minKHz, next));
}
