/** Opens while the mic is above the threshold, and stays open through the release delay. */
export interface VoiceGate {
  open: boolean;
  belowSince: number | null;
}

export function voiceThreshold(sensitivity: number): number {
  const s = Math.min(1, Math.max(0, sensitivity));
  return 0.2 - s * 0.18;
}

export function stepVoiceGate(input: {
  open: boolean;
  rms: number;
  sensitivity: number;
  releaseMs: number;
  belowSince: number | null;
  now: number;
}): VoiceGate {
  const above = input.rms >= voiceThreshold(input.sensitivity);
  if (above) return { open: true, belowSince: null };
  if (!input.open) return { open: false, belowSince: null };
  const since = input.belowSince ?? input.now;
  if (input.now - since >= input.releaseMs) return { open: false, belowSince: null };
  return { open: true, belowSince: since };
}
