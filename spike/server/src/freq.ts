/**
 * Frequencies are stored as integer kHz to avoid float bugs (59.5 MHz -> 59500).
 * Band defaults follow military VHF FM radios (30.000-87.975 MHz, 25 kHz steps),
 * which feels familiar to milsim players. Both are config, not hard rules.
 */
export interface Band {
  minKHz: number;
  maxKHz: number;
  stepKHz: number;
}

export const DEFAULT_BAND: Band = { minKHz: 30_000, maxKHz: 87_975, stepKHz: 25 };

/** Parse user input like "59.5", "59.500", "59.5 MHz", "59500" (kHz) into kHz. */
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
    return `Frequency must be in ${band.stepKHz} kHz steps`;
  return null;
}

/** 59500 -> "59.500" */
export function formatFrequency(kHz: number): string {
  return `${Math.floor(kHz / 1000)}.${String(kHz % 1000).padStart(3, '0')}`;
}
