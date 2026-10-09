/** Mirrors server/src/freq.ts: "50.5" | "50.5 MHz" | "50500" -> kHz, else null. */
export { parseFreqInput, formatFreqKHz, stepFrequency, validateFrequency, DEFAULT_BAND } from '../../../shared/freq';
export type { Band } from '../../../shared/freq';
