import { SosFilter, designBandpass, designLowpass } from './biquad';

/**
 * Listener-side radio colour and the local transmission cues.
 * The numbers are the approved chain in docs/radio-filter/DECISIONS.md.
 * A live stream cannot see a whole clip's peak, so peak, RMS, and the
 * speech-envelope normaliser are leaky. That is the main difference from
 * the offline Python demos.
 */

export const RADIO_FILTERS = ['clean', 'handheld', 'degraded', 'digital'] as const;
export type RadioFilterPreset = (typeof RADIO_FILTERS)[number];

export const CUE_START_HZ = [493.9, 587.3, 740] as const;
export const CUE_END_HZ = [740, 587.3, 440] as const;
export const CUE_START_S = [0.044, 0.044, 0.063] as const;
export const CUE_END_S = [0.044, 0.044, 0.075] as const;
export const CUE_ATTACK_S = 0.008;
export const CUE_RELEASE_S = 0.012;
/** Fundamental, third, fifth. Matches make_v2_male.note. */
export const CUE_TIMBRE = [1, 0.3, 0.12] as const;
export const CUE_TARGET_DB = -17;

/** Two Codec2 2400 frames. The worklet waits for this much audio before it emits. */
export const DIGITAL_FRAME_MS = 40;
/** Framing plus the resampler. The listener hears Digital about this late. */
export const DIGITAL_LATENCY_MS = 55;

export interface ColourParams {
  drive: number;
  bias: number;
  ratio: number;
  hissDb: number;
  floor: number;
}

export const HANDHELD: ColourParams = { drive: 1.6, bias: 0.12, ratio: 3, hissDb: -42, floor: 0.35 };
export const DEGRADED: ColourParams = { drive: 2.6, bias: 0.2, ratio: 6, hissDb: -36, floor: 0.5 };

export function parseRadioFilter(value: unknown): RadioFilterPreset {
  return value === 'handheld' || value === 'degraded' || value === 'digital' ? value : 'clean';
}

/** A channel override. Null means follow this person's default. Clean is a real override. */
export function parseChannelFilter(value: unknown): RadioFilterPreset | null {
  if (value === 'clean' || value === 'handheld' || value === 'degraded' || value === 'digital') return value;
  return null;
}

export function effectiveFilter(channel: RadioFilterPreset | null | undefined, fallback: RadioFilterPreset): RadioFilterPreset {
  return channel ?? fallback;
}

/** Ids that started or stopped since the previous active set. Order follows `next`, then `prev`. */
export function transmissionCueEdges(prev: readonly string[], next: readonly string[]): { start: string[]; end: string[] } {
  const before = new Set(prev);
  const after = new Set(next);
  return {
    start: next.filter((id) => !before.has(id)),
    end: prev.filter((id) => !after.has(id)),
  };
}

function trunc(n: number): number {
  return n < 0 ? Math.ceil(n) : Math.floor(n);
}

function linspace(start: number, end: number, n: number): Float64Array {
  const out = new Float64Array(n);
  if (n <= 1) {
    if (n === 1) out[0] = start;
    return out;
  }
  const step = (end - start) / (n - 1);
  for (let i = 0; i < n; i++) out[i] = start + step * i;
  return out;
}

function synthNote(freq: number, dur: number, sampleRate: number): Float32Array {
  const n = trunc(sampleRate * dur);
  const out = new Float32Array(n);
  if (n === 0) return out;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    let s = 0;
    for (let h = 0; h < CUE_TIMBRE.length; h++) {
      const k = h === 0 ? 1 : h === 1 ? 3 : 5;
      s += CUE_TIMBRE[h] * Math.sin(2 * Math.PI * freq * k * t);
    }
    out[i] = s;
    peak = Math.max(peak, Math.abs(s));
  }
  const attack = trunc(sampleRate * CUE_ATTACK_S);
  const release = trunc(sampleRate * CUE_RELEASE_S);
  const attackEnv = linspace(0, Math.PI / 2, Math.max(attack, 1));
  const releaseEnv = linspace(0, Math.PI / 2, Math.max(release, 1));
  const scale = peak > 0 ? 0.35 / peak : 0;
  for (let i = 0; i < n; i++) {
    let e = 1;
    if (i < attack) e = Math.sin(attackEnv[i]) ** 2;
    if (i >= n - release) e = Math.cos(releaseEnv[i - (n - release)]) ** 2;
    out[i] *= scale * e;
  }
  return out;
}

function concatCue(kind: 'start' | 'end', sampleRate: number): Float32Array {
  const freqs = kind === 'start' ? CUE_START_HZ : CUE_END_HZ;
  const durs = kind === 'start' ? CUE_START_S : CUE_END_S;
  const notes = freqs.map((freq, i) => synthNote(freq, durs[i], sampleRate));
  const out = new Float32Array(notes.reduce((sum, note) => sum + note.length, 0));
  let offset = 0;
  for (const note of notes) {
    out.set(note, offset);
    offset += note.length;
  }
  return out;
}

/** RMS of samples louder than 1e-4, matching the Python reference. */
export function rmsAbove(samples: ArrayLike<number>): number {
  let acc = 0;
  let n = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    if (Math.abs(v) > 1e-4) {
      acc += v * v;
      n++;
    }
  }
  return n ? Math.sqrt(acc / n) : 0;
}

/**
 * Soft-square start or end cue at about -17 dB RMS.
 * Both cues use the start cue's gain, as make_v4.py does for A-down3-long.
 */
export function synthesizeCue(kind: 'start' | 'end', sampleRate: number): Float32Array {
  const start = concatCue('start', sampleRate);
  const startRms = rmsAbove(start);
  const gain = startRms > 0 ? 10 ** (CUE_TARGET_DB / 20) / startRms : 0;
  const dry = kind === 'start' ? start : concatCue('end', sampleRate);
  const out = new Float32Array(dry.length);
  for (let i = 0; i < dry.length; i++) out[i] = dry[i] * gain;
  return out;
}

function coef(seconds: number, sampleRate: number): number {
  return Math.exp(-1 / (sampleRate * seconds));
}

function follow(state: number, value: number, att: number, rel: number): number {
  const c = value > state ? att : rel;
  return c * state + (1 - c) * value;
}

function warm(x: number, drive: number, bias: number): number {
  return (Math.tanh(drive * (x + bias)) - Math.tanh(drive * bias)) / drive;
}

function xorshift(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296 * 2 - 1;
  };
}

function resampleLinear(input: Float32Array, outLen: number): Float32Array {
  const out = new Float32Array(outLen);
  if (outLen === 0 || input.length === 0) return out;
  if (outLen === 1) {
    out[0] = input[0];
    return out;
  }
  const scale = (input.length - 1) / (outLen - 1);
  for (let i = 0; i < outLen; i++) {
    const x = i * scale;
    const i0 = Math.floor(x);
    const frac = x - i0;
    const a = input[i0] ?? 0;
    const b = input[Math.min(i0 + 1, input.length - 1)] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/** 8 kHz PCM in, 8 kHz PCM out. One session per remote voice. */
export interface Codec2Voice {
  samplesPerFrame: number;
  process(pcm: Int16Array): Int16Array;
}

const DB24 = 10 ** (-24 / 20);
const DB38 = 10 ** (-38 / 20);
const LEVEL_ANALOGUE = 10 ** (-20 / 20);
const LEVEL_DIGITAL = 10 ** (-21 / 20);

/**
 * One remote voice. Clean never constructs this. Handheld, Degraded, and
 * Digital all run here so the approved ratios stay in one place.
 */
export class VoiceColour {
  carrier = false;
  codec: Codec2Voice | null = null;
  private preset: 'handheld' | 'degraded' | 'digital';
  private bpVoice: SosFilter;
  private bpClean: SosFilter;
  private digBp: SosFilter;
  private decim: SosFilter;
  private noise: Float32Array;
  private noisePos = 0;
  private voicePeak = 0.05;
  private normGain = 1;
  private voiceMs = 1e-6;
  private env = 0;
  private envPeak = 1e-4;
  private tx = 0;
  private agcPeak = 0.05;
  private agcEnv = 0;
  private levelSlot = { ms: 1e-4, gain: 1 };
  private digPeak = 0.05;
  private gateEnv = 0;
  private gateGain = 0;
  private gateOpenUntil = 0;
  private sampleIndex = 0;
  private digCompEnv = 0;
  private digLevelMs = 1e-4;
  private digLevelGain = 1;
  private digitalIn: number[] = [];
  private digitalOut: number[] = [];
  private digitalRead = 0;
  private readonly frameSamples: number;
  private readonly txStep: number;
  private readonly peakHold: number;
  private readonly envAtt: number;
  private readonly envRel: number;
  private readonly envPeakHold: number;
  private readonly msCoef: number;
  private readonly agcAtt: number;
  private readonly agcRel: number;
  private readonly levelCoef: number;
  private readonly normUp: number;
  private readonly gateAtt: number;
  private readonly gateRel: number;
  private readonly gateRamp: number;
  private readonly holdSamples: number;
  private readonly compAtt: number;
  private readonly compRel: number;

  constructor(private sampleRate: number, preset: 'handheld' | 'degraded' | 'digital' = 'handheld') {
    this.preset = preset;
    this.bpVoice = new SosFilter(designBandpass(4, 300, 3400, sampleRate));
    this.bpClean = new SosFilter(designBandpass(2, 280, 3600, sampleRate));
    this.digBp = new SosFilter(designBandpass(4, 300, 3400, sampleRate));
    this.decim = new SosFilter(designLowpass(4, 3600, sampleRate));
    this.frameSamples = Math.max(1, Math.round(sampleRate * (DIGITAL_FRAME_MS / 1000)));
    this.txStep = 1 / Math.max(1, sampleRate * 0.015);
    this.peakHold = coef(2, sampleRate);
    this.envAtt = coef(0.02, sampleRate);
    this.envRel = coef(0.12, sampleRate);
    this.envPeakHold = coef(1.5, sampleRate);
    this.msCoef = coef(0.3, sampleRate);
    this.agcAtt = coef(0.005, sampleRate);
    this.agcRel = coef(0.18, sampleRate);
    this.levelCoef = coef(0.15, sampleRate);
    this.normUp = coef(0.4, sampleRate);
    this.gateAtt = coef(0.002, sampleRate);
    this.gateRel = coef(0.03, sampleRate);
    this.gateRamp = 1 / Math.max(1, sampleRate * 0.003);
    this.holdSamples = Math.round(sampleRate * 0.04);
    this.compAtt = coef(0.003, sampleRate);
    this.compRel = coef(0.08, sampleRate);
    this.noise = this.makeNoise();
  }

  setPreset(preset: 'handheld' | 'degraded' | 'digital') {
    if (preset === this.preset) return;
    this.preset = preset;
    this.digitalIn = [];
    this.digitalOut = [];
    this.digitalRead = 0;
  }

  processInto(input: Float32Array, output: Float32Array) {
    if (this.preset === 'digital') this.processDigital(input, output);
    else this.processAnalogue(input, output);
  }

  private params(): ColourParams {
    return this.preset === 'degraded' ? DEGRADED : HANDHELD;
  }

  private makeNoise(): Float32Array {
    const warmup = Math.round(this.sampleRate * 0.1);
    const n = this.sampleRate;
    const bp = new SosFilter(designBandpass(2, 300, 3400, this.sampleRate));
    const rnd = xorshift(11);
    const noise = new Float32Array(n);
    let acc = 0;
    for (let i = 0; i < n + warmup; i++) {
      const y = bp.step(rnd());
      if (i >= warmup) {
        noise[i - warmup] = y;
        acc += y * y;
      }
    }
    const std = Math.sqrt(acc / n) || 1;
    for (let i = 0; i < n; i++) noise[i] /= std;
    return noise;
  }

  private processAnalogue(input: Float32Array, output: Float32Array) {
    const p = this.params();
    const hissLin = 10 ** (p.hissDb / 20);
    for (let i = 0; i < input.length; i++) {
      let v = this.bpVoice.step(input[i]);
      this.voicePeak = Math.max(Math.abs(v), this.voicePeak * this.peakHold);
      const normTarget = 0.8 / Math.max(this.voicePeak, 1e-4);
      this.normGain = normTarget < this.normGain ? normTarget : this.normUp * this.normGain + (1 - this.normUp) * normTarget;
      v = warm(v * this.normGain, p.drive, p.bias);
      v = this.bpClean.step(v);

      const av = Math.abs(v);
      if (av > 1e-4) this.voiceMs = this.msCoef * this.voiceMs + (1 - this.msCoef) * av * av;
      else if (!this.carrier) this.voiceMs *= this.msCoef;
      const voiceRms = Math.sqrt(this.voiceMs);
      this.env = follow(this.env, av, this.envAtt, this.envRel);
      this.envPeak = Math.max(this.env, this.envPeak * this.envPeakHold);
      const envNorm = Math.min(1, this.env / Math.max(this.envPeak, 1e-8));
      const txTarget = this.carrier ? 1 : 0;
      const step = Math.min(this.txStep, Math.abs(txTarget - this.tx));
      this.tx += Math.sign(txTarget - this.tx) * step;
      const hiss = this.noise[this.noisePos] * voiceRms * hissLin * (p.floor + (1 - p.floor) * envNorm) * this.tx;
      this.noisePos = (this.noisePos + 1) % this.noise.length;

      let mix = v + hiss;
      this.agcPeak = Math.max(Math.abs(mix), this.agcPeak * this.peakHold);
      this.agcEnv = follow(this.agcEnv, Math.abs(mix), this.agcAtt, this.agcRel);
      const thr = this.agcPeak * DB24;
      if (this.agcEnv > thr && thr > 0) {
        const over = 20 * Math.log10(this.agcEnv / thr);
        mix *= 10 ** ((-over * (1 - 1 / p.ratio)) / 20);
      }
      output[i] = this.levelSample(mix, this.levelSlot, LEVEL_ANALOGUE);
    }
  }

  private levelSample(sample: number, slot: { ms: number; gain: number }, target: number): number {
    const a = Math.abs(sample);
    if (a > 1e-4) slot.ms = this.msCoef * slot.ms + (1 - this.msCoef) * a * a;
    const r = Math.sqrt(slot.ms);
    if (r > 1e-5) {
      const want = Math.min(12, Math.max(0.05, target / r));
      slot.gain = this.levelCoef * slot.gain + (1 - this.levelCoef) * want;
    }
    let y = sample * slot.gain;
    if (y > 0.89 || y < -0.89) y = Math.tanh(y / 0.89) * 0.89;
    return y;
  }

  private processDigital(input: Float32Array, output: Float32Array) {
    if (!this.codec) {
      output.set(input);
      return;
    }
    for (let i = 0; i < input.length; i++) this.digitalIn.push(input[i]);
    while (this.digitalIn.length >= this.frameSamples) {
      const chunk = new Float32Array(this.frameSamples);
      for (let i = 0; i < this.frameSamples; i++) chunk[i] = this.decim.step(this.digitalIn[i]);
      this.digitalIn.splice(0, this.frameSamples);
      const pcm8 = resampleLinear(chunk, 320);
      const coded = this.runCodec(pcm8);
      const back = resampleLinear(coded, this.frameSamples);
      for (let i = 0; i < back.length; i++) this.digitalOut.push(this.digitalSample(back[i]));
    }
    for (let i = 0; i < output.length; i++) {
      output[i] = this.digitalRead < this.digitalOut.length ? this.digitalOut[this.digitalRead++] : 0;
    }
    if (this.digitalRead > 4096) {
      this.digitalOut.splice(0, this.digitalRead);
      this.digitalRead = 0;
    }
  }

  private runCodec(pcm8: Float32Array): Float32Array {
    const codec = this.codec!;
    const n = codec.samplesPerFrame;
    const frames = Math.ceil(pcm8.length / n);
    const inn = new Int16Array(frames * n);
    for (let i = 0; i < pcm8.length; i++) {
      const s = Math.max(-1, Math.min(1, pcm8[i]));
      inn[i] = (s * 32767) | 0;
    }
    const out = codec.process(inn);
    const floats = new Float32Array(pcm8.length);
    for (let i = 0; i < floats.length; i++) floats[i] = (out[i] ?? 0) / 32768;
    return floats;
  }

  private digitalSample(x: number): number {
    const bp = this.digBp.step(x);
    this.digPeak = Math.max(Math.abs(bp), this.digPeak * this.peakHold);
    this.gateEnv = follow(this.gateEnv, Math.abs(bp), this.gateAtt, this.gateRel);
    if (this.gateEnv > this.digPeak * DB38) this.gateOpenUntil = this.sampleIndex + this.holdSamples;
    const open = this.sampleIndex < this.gateOpenUntil ? 1 : 0;
    const step = Math.min(this.gateRamp, Math.abs(open - this.gateGain));
    this.gateGain += Math.sign(open - this.gateGain) * step;
    let y = bp * this.gateGain;
    this.digCompEnv = follow(this.digCompEnv, Math.abs(y), this.compAtt, this.compRel);
    const thr = this.digPeak * DB24;
    if (this.digCompEnv > thr && thr > 0) {
      const over = 20 * Math.log10(this.digCompEnv / thr);
      y *= 10 ** ((-over * (1 - 1 / 4)) / 20);
    }
    const pk = Math.max(this.digPeak, 1e-4);
    let n = y / pk;
    const clip = 1.4;
    n = Math.max(-1, Math.min(1, n * clip)) / clip;
    y = n * pk;
    const slot = { ms: this.digLevelMs, gain: this.digLevelGain };
    const out = this.levelSample(y, slot, LEVEL_DIGITAL);
    this.digLevelMs = slot.ms;
    this.digLevelGain = slot.gain;
    this.sampleIndex++;
    return out;
  }
}
