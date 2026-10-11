/**
 * Butterworth SOS filters matching scipy.signal.butter.
 * Web Audio's BiquadFilterNode bandpass is a different curve, so the approved
 * radio chain uses these sections inside the voice worklet.
 */

interface C {
  re: number;
  im: number;
}

/** [b0, b1, b2, a0, a1, a2] with a0 = 1, scipy sos order. */
export type Sos = [number, number, number, number, number, number];

function c(re: number, im = 0): C {
  return { re, im };
}

function cadd(a: C, b: C): C {
  return { re: a.re + b.re, im: a.im + b.im };
}

function csub(a: C, b: C): C {
  return { re: a.re - b.re, im: a.im - b.im };
}

function cmul(a: C, b: C): C {
  return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}

function cdiv(a: C, b: C): C {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
}

/** Principal square root, same branch as numpy. */
function csqrt(a: C): C {
  if (a.re === 0 && a.im === 0) return c(0);
  const r = Math.hypot(a.re, a.im);
  const re = Math.sqrt((r + a.re) / 2);
  let im = Math.sqrt(Math.max(0, (r - a.re) / 2));
  if (a.im < 0) im = -im;
  return { re, im };
}

function butterAnalog(order: number): { z: C[]; p: C[]; k: number } {
  const p: C[] = [];
  for (let i = 0; i < order; i++) {
    const m = -order + 1 + 2 * i;
    const theta = (Math.PI * m) / (2 * order);
    p.push({ re: -Math.cos(theta), im: -Math.sin(theta) });
  }
  return { z: [], p, k: 1 };
}

function bilinear(z: C[], p: C[], k: number, fs: number): { z: C[]; p: C[]; k: number } {
  const degree = p.length - z.length;
  const fs2 = 2 * fs;
  const map = (a: C) => cdiv(c(fs2 + a.re, a.im), c(fs2 - a.re, -a.im));
  const zz = z.map(map);
  for (let i = 0; i < degree; i++) zz.push(c(-1));
  const pp = p.map(map);
  let num = c(1);
  let den = c(1);
  for (const a of z) num = cmul(num, c(fs2 - a.re, -a.im));
  for (const a of p) den = cmul(den, c(fs2 - a.re, -a.im));
  return { z: zz, p: pp, k: k * cdiv(num, den).re };
}

function pairConjugates(arr: C[]): Array<[C, C]> {
  const left = arr.map((x) => ({ re: x.re, im: x.im }));
  const pairs: Array<[C, C]> = [];
  while (left.length) {
    const a = left.pop()!;
    const conj = { re: a.re, im: -a.im };
    let best = -1;
    let bestErr = Infinity;
    for (let i = 0; i < left.length; i++) {
      const d = Math.hypot(left[i].re - conj.re, left[i].im - conj.im);
      if (d < bestErr) {
        bestErr = d;
        best = i;
      }
    }
    if (best >= 0 && bestErr < 1e-4) {
      pairs.push([a, left.splice(best, 1)[0]]);
      continue;
    }
    if (Math.abs(a.im) < 1e-8) {
      const realIdx = left.findIndex((x) => Math.abs(x.im) < 1e-8);
      if (realIdx >= 0) {
        pairs.push([a, left.splice(realIdx, 1)[0]]);
        continue;
      }
    }
    pairs.push([a, conj]);
  }
  return pairs;
}

function zpkToSos(z: C[], p: C[], k: number): Sos[] {
  const poles = pairConjugates(p);
  const zeros = pairConjugates(z);
  while (zeros.length < poles.length) zeros.push([c(0), c(0)]);
  const used = new Array(zeros.length).fill(false);
  const sos: Sos[] = [];
  poles.forEach((pole, index) => {
    const pc = { re: (pole[0].re + pole[1].re) / 2, im: (pole[0].im + pole[1].im) / 2 };
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < zeros.length; i++) {
      if (used[i]) continue;
      const zc = { re: (zeros[i][0].re + zeros[i][1].re) / 2, im: (zeros[i][0].im + zeros[i][1].im) / 2 };
      const d = Math.hypot(pc.re - zc.re, pc.im - zc.im);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    used[best] = true;
    const [z1, z2] = zeros[best];
    const zsum = cadd(z1, z2);
    const zprod = cmul(z1, z2);
    const psum = cadd(pole[0], pole[1]);
    const pprod = cmul(pole[0], pole[1]);
    let b0 = 1;
    let b1 = -zsum.re;
    let b2 = zprod.re;
    if (index === 0) {
      b0 *= k;
      b1 *= k;
      b2 *= k;
    }
    sos.push([b0, b1, b2, 1, -psum.re, pprod.re]);
  });
  return sos;
}

/** scipy.signal.butter(order, freq, 'lowpass', fs=fs). `order` is the analog prototype order. */
export function designLowpass(order: number, freq: number, fs: number): Sos[] {
  const warped = 2 * fs * Math.tan((Math.PI * freq) / fs);
  const analog = butterAnalog(order);
  const p = analog.p.map((pole) => cmul(pole, c(warped)));
  const k = analog.k * warped ** order;
  const digital = bilinear(analog.z, p, k, fs);
  return zpkToSos(digital.z, digital.p, digital.k);
}

/** scipy.signal.butter(order, [lo, hi], 'bandpass', fs=fs). `order` is the analog prototype order. */
export function designBandpass(order: number, lo: number, hi: number, fs: number): Sos[] {
  const lowW = 2 * fs * Math.tan((Math.PI * lo) / fs);
  const highW = 2 * fs * Math.tan((Math.PI * hi) / fs);
  const wo = Math.sqrt(lowW * highW);
  const bw = highW - lowW;
  const analog = butterAnalog(order);
  const degree = analog.p.length - analog.z.length;
  const scale = bw / 2;
  const zs = analog.z.map((zero) => cmul(zero, c(scale)));
  const ps = analog.p.map((pole) => cmul(pole, c(scale)));
  const wo2 = c(wo * wo);
  const dup = (arr: C[]) => {
    const out: C[] = [];
    for (const a of arr) {
      const root = csqrt(csub(cmul(a, a), wo2));
      out.push(cadd(a, root), csub(a, root));
    }
    return out;
  };
  const zbp = dup(zs);
  for (let i = 0; i < degree; i++) zbp.push(c(0));
  const digital = bilinear(zbp, dup(ps), analog.k * bw ** degree, fs);
  return zpkToSos(digital.z, digital.p, digital.k);
}

/** Magnitude in dB of a cascaded SOS at one frequency. */
export function sosMagnitudeDb(sos: Sos[], freq: number, fs: number): number {
  const w = (2 * Math.PI * freq) / fs;
  let re = 1;
  let im = 0;
  const zr = Math.cos(w);
  const zi = Math.sin(w);
  for (const [b0, b1, b2, , a1, a2] of sos) {
    // z^-1 = cos(w) - j sin(w)
    const z1r = zr;
    const z1i = -zi;
    const z2r = z1r * z1r - z1i * z1i;
    const z2i = 2 * z1r * z1i;
    const nr = b0 + b1 * z1r + b2 * z2r;
    const ni = b1 * z1i + b2 * z2i;
    const dr = 1 + a1 * z1r + a2 * z2r;
    const di = a1 * z1i + a2 * z2i;
    const den = dr * dr + di * di;
    const hr = (nr * dr + ni * di) / den;
    const hi = (ni * dr - nr * di) / den;
    const nr2 = re * hr - im * hi;
    const ni2 = re * hi + im * hr;
    re = nr2;
    im = ni2;
  }
  return 20 * Math.log10(Math.hypot(re, im) + 1e-15);
}

/** Direct form II transposed. State stays across blocks, matching scipy.signal.sosfilt. */
export class SosFilter {
  private s1: number[];
  private s2: number[];

  constructor(private sos: Sos[]) {
    this.s1 = sos.map(() => 0);
    this.s2 = sos.map(() => 0);
  }

  step(x: number): number {
    let y = x;
    for (let i = 0; i < this.sos.length; i++) {
      const [b0, b1, b2, , a1, a2] = this.sos[i];
      const out = b0 * y + this.s1[i];
      this.s1[i] = b1 * y - a1 * out + this.s2[i];
      this.s2[i] = b2 * y - a2 * out;
      y = out;
    }
    return y;
  }
}
