/**
 * Frequencies are stored as integer kHz to avoid float bugs (50.5 MHz -> 50500).
 * Channels sit on 0.5 MHz steps from 30.0 to 87.5 MHz. The step and the ends are config.
 */
export interface Band {
  minKHz: number;
  maxKHz: number;
  stepKHz: number;
}

export const DEFAULT_BAND: Band = { minKHz: 30_000, maxKHz: 87_500, stepKHz: 500 };

/** Parse user input like "50.5", "50.500", "50.5 MHz", "50500" (kHz) into kHz. */
export function parseFrequency(input: string | number): number | null {
  const s = String(input).trim().toLowerCase().replace(/\s*(mhz|m)$/, '');
  if (!/^\d{1,3}(\.\d{1,3})?$/.test(s) && !/^\d{4,6}$/.test(s)) return null;
  if (/^\d{4,6}$/.test(s)) return Number(s); // already kHz
  const [whole, frac = ''] = s.split('.');
  return Number(whole) * 1000 + Number(frac.padEnd(3, '0'));
}

export function validateFrequency(kHz: number, band: Band = DEFAULT_BAND): string | null {
  if (!Number.isInteger(kHz)) return 'Frequency must be a whole number of kHz';
  if (kHz < band.minKHz || kHz > band.maxKHz)
    return `Frequency must be between ${formatFrequency(band.minKHz)} and ${formatFrequency(band.maxKHz)} MHz`;
  if ((kHz - band.minKHz) % band.stepKHz !== 0)
    return `Frequency must be in ${band.stepKHz / 1000} MHz steps`;
  return null;
}

/** 50500 -> "50.5", 50000 -> "50.0". One decimal place. */
export function formatFrequency(kHz: number): string {
  const negative = kHz < 0;
  const scaled = Math.round(Math.abs(kHz) / 100);
  const text = `${Math.floor(scaled / 10)}.${scaled % 10}`;
  return negative ? `-${text}` : text;
}
