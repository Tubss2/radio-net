/** Voice-quality numbers for one tab. No audio, callsign, invite, or token. */

export interface StatRecord {
  type: string;
  kind?: string;
  state?: string;
  nominated?: boolean;
  currentRoundTripTime?: number;
  jitter?: number;
  packetsLost?: number;
  packetsReceived?: number;
  fractionLost?: number;
  roundTripTime?: number;
}

export interface RtcSample {
  rttMs: number | null;
  jitterMs: number | null;
  lossPct: number | null;
}

export interface StatSummary {
  p50: number;
  p95: number;
  max: number;
}

export interface RoomSummary {
  freq: string;
  reconnects: number;
  rttMsP50: number;
  jitterMsP95: number;
  lossPctP95: number;
}

export interface VoiceReport {
  v: 1;
  clientId: string;
  appVersion: string;
  surface: 'web' | 'electron';
  browser: string;
  platform: string;
  mobile: boolean;
  tuned: number;
  reconnects: number;
  disconnects: number;
  pttPresses: number;
  pttFailures: number;
  rttMs: StatSummary;
  jitterMs: StatSummary;
  lossPct: StatSummary;
  rooms: RoomSummary[];
}

export interface VoiceReportMeta {
  clientId: string;
  appVersion: string;
  surface: 'web' | 'electron';
  browser: string;
  platform: string;
  mobile: boolean;
  tuned: number;
}

const MAX_SAMPLES = 120;
const MAX_ROOMS = 16;

interface RoomBuf {
  samples: RtcSample[];
  reconnects: number;
}

/** Pull RTT, jitter, and loss out of one WebRTC stats dump. */
export function sampleFromStats(stats: Iterable<StatRecord>): RtcSample {
  let rttMs: number | null = null;
  let jitterMs: number | null = null;
  let lost = 0;
  let received = 0;
  let sawPackets = false;
  for (const row of stats) {
    if (row.type === 'candidate-pair' && row.state === 'succeeded' && row.nominated !== false) {
      if (typeof row.currentRoundTripTime === 'number') rttMs = row.currentRoundTripTime * 1000;
    }
    if (row.type === 'remote-inbound-rtp' && row.kind === 'audio') {
      if (typeof row.roundTripTime === 'number') rttMs = row.roundTripTime * 1000;
      if (jitterMs === null && typeof row.jitter === 'number') jitterMs = row.jitter * 1000;
    }
    if (row.type === 'inbound-rtp' && (row.kind === 'audio' || row.kind === undefined)) {
      // Received-audio jitter wins over the remote view of our own outbound stream.
      if (typeof row.jitter === 'number') jitterMs = row.jitter * 1000;
      if (typeof row.packetsLost === 'number') {
        lost += row.packetsLost;
        sawPackets = true;
      }
      if (typeof row.packetsReceived === 'number') {
        received += row.packetsReceived;
        sawPackets = true;
      }
    }
  }
  const total = received + Math.max(0, lost);
  const lossPct = sawPackets && total > 0 ? (Math.max(0, lost) / total) * 100 : null;
  return { rttMs, jitterMs, lossPct };
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return round1(sorted[index] ?? 0);
}

export function browserLabel(userAgent: string): string {
  const edge = /Edg\/(\d+)/.exec(userAgent);
  if (edge) return `Edge ${edge[1]}`;
  const firefox = /Firefox\/(\d+)/.exec(userAgent);
  if (firefox) return `Firefox ${firefox[1]}`;
  const chrome = /Chrome\/(\d+)/.exec(userAgent);
  if (chrome) return `Chrome ${chrome[1]}`;
  const safari = /Version\/(\d+).+Safari/.exec(userAgent);
  if (safari) return `Safari ${safari[1]}`;
  return 'unknown';
}

function round1(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(Math.min(n, 1_000_000) * 10) / 10;
}

function summarize(values: number[]): StatSummary {
  return { p50: percentile(values, 50), p95: percentile(values, 95), max: round1(values.length ? Math.max(...values) : 0) };
}

/** Counts for the open radio tab. The page sends this only when the user asks. */
export class VoiceSession {
  private rooms = new Map<string, RoomBuf>();
  reconnects = 0;
  disconnects = 0;
  pttPresses = 0;
  pttFailures = 0;

  noteReconnect(freq: string): void {
    this.reconnects += 1;
    this.room(freq).reconnects += 1;
  }

  noteDisconnect(freq: string): void {
    this.disconnects += 1;
  }

  notePtt(ok: boolean): void {
    if (ok) this.pttPresses += 1;
    else this.pttFailures += 1;
  }

  noteSample(freq: string, sample: RtcSample): void {
    if (sample.rttMs === null && sample.jitterMs === null && sample.lossPct === null) return;
    const buf = this.room(freq);
    buf.samples.push({
      rttMs: sample.rttMs === null ? null : round1(sample.rttMs),
      jitterMs: sample.jitterMs === null ? null : round1(sample.jitterMs),
      lossPct: sample.lossPct === null ? null : round1(sample.lossPct),
    });
    if (buf.samples.length > MAX_SAMPLES) buf.samples.splice(0, buf.samples.length - MAX_SAMPLES);
  }

  report(meta: VoiceReportMeta): VoiceReport {
    const rtt: number[] = [];
    const jitter: number[] = [];
    const loss: number[] = [];
    const rooms: RoomSummary[] = [];
    for (const [freq, buf] of this.rooms) {
      const roomRtt = nums(buf.samples, 'rttMs');
      const roomJitter = nums(buf.samples, 'jitterMs');
      const roomLoss = nums(buf.samples, 'lossPct');
      rtt.push(...roomRtt);
      jitter.push(...roomJitter);
      loss.push(...roomLoss);
      rooms.push({
        freq,
        reconnects: buf.reconnects,
        rttMsP50: percentile(roomRtt, 50),
        jitterMsP95: percentile(roomJitter, 95),
        lossPctP95: percentile(roomLoss, 95),
      });
    }
    rooms.sort((a, b) => a.freq.localeCompare(b.freq));
    return {
      v: 1,
      clientId: meta.clientId,
      appVersion: meta.appVersion.slice(0, 32),
      surface: meta.surface,
      browser: meta.browser.slice(0, 40),
      platform: meta.platform.slice(0, 40),
      mobile: meta.mobile,
      tuned: Math.max(0, Math.min(32, Math.round(meta.tuned))),
      reconnects: this.reconnects,
      disconnects: this.disconnects,
      pttPresses: this.pttPresses,
      pttFailures: this.pttFailures,
      rttMs: summarize(rtt),
      jitterMs: summarize(jitter),
      lossPct: summarize(loss),
      rooms: rooms.slice(0, MAX_ROOMS),
    };
  }

  private room(freq: string): RoomBuf {
    const key = /^\d{2}\.\d$/.test(freq) ? freq : '00.0';
    const existing = this.rooms.get(key);
    if (existing) return existing;
    if (this.rooms.size >= MAX_ROOMS) {
      const first = this.rooms.keys().next().value;
      if (first) this.rooms.delete(first);
    }
    const created: RoomBuf = { samples: [], reconnects: 0 };
    this.rooms.set(key, created);
    return created;
  }
}

function nums(samples: RtcSample[], key: keyof RtcSample): number[] {
  const out: number[] = [];
  for (const sample of samples) {
    const value = sample[key];
    if (typeof value === 'number') out.push(value);
  }
  return out;
}
