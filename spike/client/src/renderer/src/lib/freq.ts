/** Mirrors server/src/freq.ts parseFrequency: "59.5" | "59.500 MHz" | "59500" -> kHz, else null. */
export { parseFreqInput, formatFreqKHz, stepFrequency, DEFAULT_BAND } from '../../../shared/freq';
export type { Band } from '../../../shared/freq';
