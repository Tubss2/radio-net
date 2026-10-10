import type { ChannelInfo } from './api';
import { PREVIEW_CHANNELS } from './previewApi';
import type { RadioControl, TunedChannel } from './radioEngine';

export type PreviewDemo = 'auto' | 'silence' | 'one' | 'two' | 'you' | 'gone';

const NAMES = ['Rhys', 'Sam', 'Alex'];

let active: PreviewEngine | null = null;
export function getPreviewEngine() { return active; }

/**
 * Radio with no microphone and no LiveKit. Tuned channels go live immediately.
 * Unless a demo button has taken over, a talker appears and drops every few seconds
 * so the corner overlay can be seen without anyone else connected.
 */
export class PreviewEngine implements RadioControl {
  private slots = new Map<string, TunedChannel>();
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  private mode: PreviewDemo = 'auto';
  txId: string | null = null;
  transmittingOn: string | null = null;
  allCalling = false;
  allCallFrom: string | null = null;
  private micHeldByTalk = false;
  version = 0;

  constructor() {
    active = this;
    if (import.meta.env.MODE !== 'test') this.timer = setInterval(() => this.stepTalkers(), 4500);
  }

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  private changed() { this.version++; this.listeners.forEach((fn) => fn()); }

  get tuned(): TunedChannel[] {
    return [...this.slots.values()].sort((a, b) => a.channel.freqKHz - b.channel.freqKHz);
  }

  unlock() { return Promise.resolve(); }
  monitorMic() { return () => undefined; }

  async tune(channel: ChannelInfo) {
    if (this.slots.has(channel.id)) return;
    this.slots.set(channel.id, {
      channel, status: 'live', canTransmit: true, volume: 1, pan: 0, muted: false, speakers: [], listeners: 4, allCallFrom: null,
    });
    if (!this.txId) this.txId = channel.id;
    this.changed();
    if (this.mode === 'auto' && this.slots.size === 1) this.stepTalkers();
  }

  async untune(channelId: string) {
    if (!this.slots.delete(channelId)) return;
    if (this.txId === channelId) this.allCalling = false;
    if (this.transmittingOn === channelId) this.transmittingOn = null;
    if (this.txId === channelId) { this.txId = null; this.cycle(); }
    this.changed();
  }

  setVolume(id: string, v: number) { const s = this.slots.get(id); if (!s) return; s.volume = v; this.changed(); }
  setMuted(id: string, m: boolean) { const s = this.slots.get(id); if (!s) return; s.muted = m; this.changed(); }
  setPan(id: string, p: number) { const s = this.slots.get(id); if (!s) return; s.pan = p; this.changed(); }
  setTx(id: string) { if (this.slots.get(id)?.canTransmit) { this.txId = id; this.changed(); } }

  ensureTx() {
    if (this.txId && this.slots.get(this.txId)?.canTransmit && this.slots.get(this.txId)?.status !== 'gone') return;
    const next = this.tuned.find((row) => row.canTransmit && row.status !== 'gone');
    const id = next?.channel.id ?? null;
    if (id === this.txId) return;
    this.txId = id;
    this.changed();
  }

  cycle(step: 1 | -1 = 1) {
    const ids = this.tuned.filter((t) => t.canTransmit && t.status !== 'gone').map((t) => t.channel.id);
    if (!ids.length) { this.txId = null; this.changed(); return; }
    const index = ids.indexOf(this.txId ?? '');
    const from = index < 0 ? (step > 0 ? -1 : 0) : index;
    this.setTx(ids[(from + step + ids.length) % ids.length]);
  }

  async ptt(down: boolean, channelId?: string): Promise<boolean> {
    const id = channelId ?? this.txId;
    if (this.allCalling && id !== this.txId) return false;
    const slot = id ? this.slots.get(id) : undefined;
    if (!slot?.canTransmit || slot.status === 'gone') return false;
    if (down) {
      this.micHeldByTalk = true;
      this.transmittingOn = id;
      this.changed();
      return true;
    }
    if (id !== this.transmittingOn && id !== this.txId) return false;
    this.micHeldByTalk = false;
    if (this.allCalling) {
      this.changed();
      return false;
    }
    if (this.transmittingOn === id) this.transmittingOn = null;
    this.changed();
    return false;
  }

  /** Opens the banner without a microphone. The preview API already accepts the admin check. */
  async holdAllCall(on: boolean): Promise<boolean> {
    if (!on) {
      if (!this.allCalling) return false;
      this.allCalling = false;
      if (!this.micHeldByTalk) this.transmittingOn = null;
      this.changed();
      return false;
    }
    const id = this.txId;
    const slot = id ? this.slots.get(id) : undefined;
    if (!slot?.canTransmit || slot.status === 'gone') return false;
    if (this.transmittingOn && this.transmittingOn !== id) return false;
    this.allCalling = true;
    this.transmittingOn = id;
    this.changed();
    return true;
  }

  /** Advance the automatic talker, or do nothing while a demo button is holding a state. */
  stepTalkers() {
    if (this.mode !== 'auto') return;
    const pool = this.tuned.filter((t) => t.status === 'live');
    for (const t of this.tuned) t.speakers = [];
    if (pool.length && this.step % 3 !== 2) {
      const first = pool[this.step % pool.length];
      first.speakers = [NAMES[this.step % NAMES.length]];
      if (this.step % 3 === 1 && pool.length > 1) {
        const second = pool[(this.step + 1) % pool.length];
        second.speakers = [NAMES[(this.step + 1) % NAMES.length]];
      }
    }
    this.step++;
    this.changed();
  }

  async demo(kind: PreviewDemo) {
    this.mode = kind;
    if (kind === 'you') {
      await this.tune(channel('cmd'));
      for (const t of this.tuned) t.speakers = [];
      this.setTx('cmd');
      await this.ptt(true);
      return;
    }
    if (this.transmittingOn) await this.ptt(false);
    if (kind === 'gone') {
      await this.tune(channel('cmd'));
      const slot = this.slots.get('cmd');
      if (slot) { slot.status = 'gone'; slot.speakers = []; }
      this.changed();
      return;
    }
    for (const t of this.tuned) if (t.status === 'gone') t.status = 'live';
    for (const t of this.tuned) t.speakers = [];
    if (kind === 'one' || kind === 'two') {
      await this.tune(channel('cmd'));
      const cmd = this.slots.get('cmd');
      if (cmd) cmd.speakers = ['Rhys'];
      if (kind === 'two') {
        await this.tune(channel('arty'));
        const arty = this.slots.get('arty');
        if (arty) arty.speakers = ['Sam'];
      }
    }
    if (kind === 'auto') this.stepTalkers();
    else this.changed();
  }

  async dispose() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.slots.clear();
    if (active === this) active = null;
  }
}

function channel(id: string): ChannelInfo {
  const found = PREVIEW_CHANNELS.find((c) => c.id === id);
  if (!found) throw new Error(`Unknown preview channel ${id}`);
  return found;
}
