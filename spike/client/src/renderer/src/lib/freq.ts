/** Mirrors server/src/freq.ts parseFrequency: "59.5" | "59.500 MHz" | "59500" -> kHz, else null. */
export function parseFreqInput(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/\s*(mhz|m)$/, '');
  if (/^\d{4,6}$/.test(s)) return Number(s);
  if (!/^\d{1,3}(\.\d{1,3})?$/.test(s)) return null;
  const [w, f = ''] = s.split('.');
  return Number(w) * 1000 + Number(f.padEnd(3, '0'));
}
