import {
  type LocalTrackPublication, type RemoteTrack, Room, RoomEvent, Track, createLocalAudioTrack, DisconnectReason,
} from 'livekit-client';
import { RECONNECTING } from '../../../shared/net';
import { pickTransmitId } from '../../../shared/transmit';
import { isReconnectError, type Api, type ChannelInfo } from './api';
import { clientLog } from './clientLog';
import { resolveLivekitUrl } from './livekitUrl';
import { ReleaseTail } from '../../../shared/roger';
import { playPttEdge, playRogerLocal, playTxChange } from './uiSounds';

/**
 * The radio: one LiveKit Room per tuned channel.
 * - Hear: every tuned room, each through its own gain + stereo-pan node.
 * - Talk: a muted mic track is pre-published in every tuned room; PTT un-mutes only the TX room,
 *   so changing TX (cycle key) is instant: no reconnect, no renegotiation.
 */
export interface TunedChannel {
  channel: ChannelInfo;
  status: 'connecting' | 'live' | 'reconnecting' | 'gone';
  canTransmit: boolean;
  volume: number; // 0..1.5
  pan: number; // -1 (left) .. 1 (right)
  muted: boolean;
  speakers: string[]; // display names talking now
  listeners: number;
}

/** What the UI needs from a radio. The real engine and the browser preview both satisfy it. */
export interface RadioControl {
  subscribe: (fn: () => void) => () => void;
  readonly version: number;
  readonly tuned: TunedChannel[];
  txId: string | null;
  transmittingOn: string | null;
  tune(channel: ChannelInfo): Promise<void>;
  untune(channelId: string): Promise<void>;
  /** The server deleted this tuned channel's room. The UI drops it from the list and the wheel. */
  onChannelDeleted?: (channelId: string) => void;
  setVolume(id: string, v: number): void;
  setMuted(id: string, m: boolean): void;
  setPan(id: string, p: number): void;
  setTx(id: string): void;
  /** A tuned channel that can transmit becomes the talk channel when none is chosen. */
  ensureTx(): void;
  /** Step the talk channel. Positive moves to the next tuned channel, negative to the previous. */
  cycle(step?: 1 | -1): void;
  /** True only after this call left the microphone unmuted. */
  ptt(down: boolean, channelId?: string): Promise<boolean>;
  /** Hang and roger beep applied the next time push-to-talk releases. */
  setRelease(opts: { hangMs: number; roger: boolean; rogerLocal: boolean }): void;
  /** Resume audio and open the mic on a user gesture. The track stays published and muted until PTT. */
  unlock(): Promise<void>;
  /** RMS of the open mic, about 0..1. Used for voice activation. */
  monitorMic(onLevel: (rms: number) => void): () => void;
  dispose(): Promise<void>;
}

interface OutgoingMix {
  dest: MediaStreamAudioDestinationNode;
}

/** Voice grants last two minutes. Refresh earlier so a tuned channel does not drop, and a ban fails the next mint. */
const GRANT_REFRESH_MS = 60_000;

interface Slot {
  info: TunedChannel;
  room: Room;
  gain: GainNode;
  panner: StereoPannerNode;
  mic?: LocalTrackPublication;
  sinks: HTMLAudioElement[];
  /** Ignore the disconnect this refresh causes. */
  refreshing: boolean;
  refreshTimer?: ReturnType<typeof setTimeout>;
}

export class RadioEngine implements RadioControl {
  private slots = new Map<string, Slot>();
  private ctx = new AudioContext({ latencyHint: 'interactive' });
  private micTrack: MediaStreamTrack | null = null;
  private listeners = new Set<() => void>();
  txId: string | null = null;
  transmittingOn: string | null = null;
  version = 0;
  onChannelDeleted?: (channelId: string) => void;
  private mix: OutgoingMix | null = null;
  private release = { hangMs: 200, roger: true, rogerLocal: false };
  private tail = new ReleaseTail((ms) => new Promise((resolve) => { setTimeout(resolve, ms); }));

  setRelease(opts: { hangMs: number; roger: boolean; rogerLocal: boolean }) {
    this.release = { ...opts };
  }

  constructor(private api: Api, private communityId: string) {}

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  private changed() { this.version++; this.listeners.forEach((f) => f()); }

  get tuned(): TunedChannel[] {
    return [...this.slots.values()].map((s) => s.info).sort((a, b) => a.channel.freqKHz - b.channel.freqKHz);
  }

  private async mic(): Promise<MediaStreamTrack> {
    if (!this.micTrack) {
      const t = await createLocalAudioTrack({ echoCancellation: true, noiseSuppression: true, autoGainControl: true });
      this.micTrack = t.mediaStreamTrack;
    }
    return this.micTrack;
  }

  async unlock() {
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    await this.mic();
  }

  monitorMic(onLevel: (rms: number) => void): () => void {
    let stopped = false;
    let raf = 0;
    let detach = () => undefined;
    void this.mic().then((track) => {
      if (stopped) return;
      const src = this.ctx.createMediaStreamSource(new MediaStream([track]));
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const tick = () => {
        if (stopped) return;
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        onLevel(Math.sqrt(sum / buf.length));
        raf = requestAnimationFrame(tick);
      };
      detach = () => { try { src.disconnect(); analyser.disconnect(); } catch { /* already stopped */ } };
      tick();
    }).catch(() => undefined);
    return () => { stopped = true; cancelAnimationFrame(raf); detach(); };
  }

  async tune(channel: ChannelInfo) {
    if (this.slots.has(channel.id)) return;
    await this.ctx.resume();
    const { livekitUrl, grants } = await this.api.tokens(this.communityId, [channel.id]);
    const grant = grants[0];
    if (!grant) throw new Error(`You can't tune ${channel.name}`);
    const room = new Room({ adaptiveStream: false, dynacast: false, disconnectOnPageLeave: true });
    const gain = this.ctx.createGain();
    const panner = this.ctx.createStereoPanner();
    gain.connect(panner).connect(this.ctx.destination);
    const slot: Slot = {
      room, gain, panner, sinks: [], refreshing: false,
      info: { channel, status: 'connecting', canTransmit: grant.canTransmit, volume: 1, pan: 0, muted: false, speakers: [], listeners: 0 },
    };
    this.slots.set(channel.id, slot);
    this.ensureTx();
    this.changed();

    room
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind !== Track.Kind.Audio) return;
        // Chromium only feeds remote WebRTC audio into WebAudio if it's also attached to a (muted) element.
        const el = new Audio();
        el.srcObject = new MediaStream([track.mediaStreamTrack]);
        el.muted = true;
        void el.play().catch(() => undefined);
        slot.sinks.push(el);
        this.ctx.createMediaStreamSource(new MediaStream([track.mediaStreamTrack])).connect(gain);
      })
      .on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        slot.info.speakers = speakers.filter((p) => p !== room.localParticipant).map((p) => p.name || p.identity);
        this.changed();
      })
      .on(RoomEvent.ParticipantConnected, () => { slot.info.listeners = room.numParticipants; this.changed(); })
      .on(RoomEvent.ParticipantDisconnected, () => { slot.info.listeners = room.numParticipants; this.changed(); })
      .on(RoomEvent.Reconnecting, () => {
        slot.info.status = 'reconnecting';
        clientLog('livekit', `reconnecting ${channel.freq}`);
        this.changed();
      })
      .on(RoomEvent.Reconnected, () => {
        slot.info.status = 'live';
        clientLog('livekit', `reconnected ${channel.freq}`);
        this.changed();
      })
      .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        if (slot.refreshing) return;
        clientLog('livekit', `disconnected ${channel.freq} ${reason ?? ''}`.trim());
        // The API deletes the LiveKit room when an admin deletes the channel. Drop the slot
        // now so the card and the wheel do not keep a channel the server has removed.
        if (reason === DisconnectReason.ROOM_DELETED) {
          this.takeSlot(channel.id);
          this.onChannelDeleted?.(channel.id);
          return;
        }
        slot.info.status = 'gone';
        this.changed();
      });

    const url = resolveLivekitUrl(livekitUrl, import.meta.env.VITE_LIVEKIT_URL);
    try {
      await room.connect(url, grant.token, { autoSubscribe: true });
    } catch (err) {
      this.slots.delete(channel.id);
      if (this.txId === channel.id) this.txId = null;
      slot.gain.disconnect();
      void room.disconnect();
      clientLog('livekit', `connect ${channel.freq} failed`);
      this.ensureTx();
      this.changed();
      if (isReconnectError(err)) throw new Error(RECONNECTING);
      throw err;
    }
    clientLog('livekit', `connected ${channel.freq}`);
    slot.info.status = 'live';
    slot.info.listeners = room.numParticipants;
    this.scheduleRefresh(channel.id);
    if (grant.canTransmit) {
      try {
        await this.publishMutedMic(slot);
      } catch (err) {
        clientLog('livekit', `mic ${channel.freq} ${(err as Error).message}`);
        if (!this.txId) this.txId = channel.id;
        this.changed();
        throw new Error('No microphone was found. The channel stays tuned. Plug in a mic to talk.');
      }
      if (!this.txId) this.txId = channel.id;
    }
    this.changed();
  }

  /**
   * Mic plus a tone, captured as the track we publish. The roger beep is mixed here so
   * everyone tuned to the channel hears it. The raw mic still has echo cancellation;
   * the beep is added after that, so noise suppression does not eat it.
   */
  private async outgoingTrack(): Promise<MediaStreamTrack> {
    const track = await this.mic();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    if (!this.mix) {
      const dest = this.ctx.createMediaStreamDestination();
      this.ctx.createMediaStreamSource(new MediaStream([track])).connect(dest);
      this.mix = { dest };
    }
    const out = this.mix.dest.stream.getAudioTracks()[0];
    if (!out) throw new Error('No outgoing audio');
    return out.clone();
  }

  /** Two short tones on the still-open carrier. Listeners hear this in the voice room. */
  private playRogerIntoMix() {
    if (!this.mix || this.ctx.state === 'closed') return;
    const now = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(1046, now);
    o.frequency.setValueAtTime(1568, now + 0.09);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.2, now + 0.012);
    g.gain.setValueAtTime(0.2, now + 0.075);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    g.gain.exponentialRampToValueAtTime(0.2, now + 0.102);
    g.gain.setValueAtTime(0.2, now + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    o.connect(g).connect(this.mix.dest);
    o.start(now);
    o.stop(now + 0.18);
  }

  private async publishMutedMic(slot: Slot) {
    const pub = await slot.room.localParticipant.publishTrack(await this.outgoingTrack(), {
      source: Track.Source.Microphone, dtx: true, red: true, name: 'mic',
    });
    await pub.mute();
    slot.mic = pub;
  }

  private scheduleRefresh(channelId: string, delay = GRANT_REFRESH_MS) {
    const slot = this.slots.get(channelId);
    if (!slot) return;
    if (slot.refreshTimer) clearTimeout(slot.refreshTimer);
    slot.refreshTimer = setTimeout(() => { void this.refreshGrant(channelId); }, delay);
  }

  /** Mint a new voice grant and reconnect. A ban fails this mint, so the channel drops instead of riding the old JWT. */
  private async refreshGrant(channelId: string) {
    const slot = this.slots.get(channelId);
    if (!slot) return;
    const wasTalking = this.transmittingOn === channelId;
    slot.refreshing = true;
    try {
      const { livekitUrl, grants } = await this.api.tokens(this.communityId, [channelId]);
      const grant = grants[0];
      if (!grant) throw new Error(`You can't tune ${slot.info.channel.name}`);
      if (wasTalking) await slot.mic?.mute().catch(() => undefined);
      const url = resolveLivekitUrl(livekitUrl, import.meta.env.VITE_LIVEKIT_URL);
      await slot.room.disconnect();
      await slot.room.connect(url, grant.token, { autoSubscribe: true });
      slot.mic = undefined;
      slot.info.canTransmit = grant.canTransmit;
      slot.info.status = 'live';
      slot.info.listeners = slot.room.numParticipants;
      if (grant.canTransmit) {
        try {
          await this.publishMutedMic(slot);
        } catch (err) {
          clientLog('livekit', `mic ${slot.info.channel.freq} ${(err as Error).message}`);
        }
      }
      if (wasTalking && slot.mic) await this.ptt(true, channelId);
      this.changed();
      this.scheduleRefresh(channelId);
    } catch (err) {
      if (isReconnectError(err)) {
        slot.info.status = 'reconnecting';
        this.changed();
        this.scheduleRefresh(channelId, 5_000);
        return;
      }
      clientLog('livekit', `refresh ${slot.info.channel.freq} ${(err as Error).message}`);
      slot.info.status = 'gone';
      this.changed();
      await slot.room.disconnect().catch(() => undefined);
    } finally {
      // The disconnect event can be delivered after disconnect() resolves. Keep ignoring it until that turn finishes.
      queueMicrotask(() => { slot.refreshing = false; });
    }
  }

  /** Remove the slot from the radio immediately. The room disconnect can finish afterwards. */
  private takeSlot(channelId: string): Slot | undefined {
    const slot = this.slots.get(channelId);
    if (!slot) return;
    if (slot.refreshTimer) clearTimeout(slot.refreshTimer);
    this.slots.delete(channelId);
    slot.sinks.forEach((e) => { e.srcObject = null; });
    try { slot.gain.disconnect(); } catch { /* already torn down */ }
    const wasTx = this.txId === channelId;
    if (wasTx) this.txId = null;
    if (this.transmittingOn === channelId) {
      this.transmittingOn = null;
      this.tail.cancel();
    }
    if (wasTx) this.cycle();
    else this.changed();
    return slot;
  }

  async untune(channelId: string) {
    const slot = this.takeSlot(channelId);
    if (!slot) return;
    await slot.room.disconnect().catch(() => undefined);
  }

  setVolume(id: string, v: number) { const s = this.slots.get(id); if (!s) return; s.info.volume = v; this.applyGain(s); }
  setMuted(id: string, m: boolean) { const s = this.slots.get(id); if (!s) return; s.info.muted = m; this.applyGain(s); }
  setPan(id: string, p: number) { const s = this.slots.get(id); if (!s) return; s.info.pan = p; s.panner.pan.value = p; this.changed(); }
  private applyGain(s: Slot) { s.gain.gain.value = s.info.muted ? 0 : s.info.volume; this.changed(); }

  setTx(id: string) {
    if (!this.slots.get(id)?.info.canTransmit) return;
    const changed = this.txId !== id;
    this.txId = id;
    if (changed) playTxChange();
    this.changed();
  }

  ensureTx() {
    const next = pickTransmitId(this.txId, this.tuned.map((row) => ({
      id: row.channel.id, canTransmit: row.canTransmit, status: row.status,
    })));
    if (next === this.txId) return;
    this.txId = next;
    this.changed();
  }

  /** Move TX to the next or previous tuned channel (by frequency). */
  cycle(step: 1 | -1 = 1) {
    const ids = this.tuned.filter((t) => t.canTransmit && t.status !== 'gone').map((t) => t.channel.id);
    if (!ids.length) { this.txId = null; this.changed(); return; }
    const index = ids.indexOf(this.txId ?? '');
    const from = index < 0 ? (step > 0 ? -1 : 0) : index;
    this.setTx(ids[(from + step + ids.length) % ids.length]);
  }

  /**
   * PTT on the TX channel, or on a specific channel (direct per-channel key).
   * transmittingOn is set only after the microphone actually unmutes, so the
   * on-air banner and the phone both wait for a live mic.
   */
  async ptt(down: boolean, channelId?: string): Promise<boolean> {
    const id = channelId ?? this.txId;
    const slot = id ? this.slots.get(id) : undefined;
    if (down) {
      this.tail.cancel();
      if (!slot?.mic) return false;
      if (this.transmittingOn && this.transmittingOn !== id) await this.ptt(false, this.transmittingOn);
      const already = this.transmittingOn === id;
      try {
        await slot.mic.unmute();
      } catch (err) {
        clientLog('livekit', `unmute ${slot.info.channel.freq} ${(err as Error).message}`);
        if (this.transmittingOn === id) this.transmittingOn = null;
        this.changed();
        return false;
      }
      this.transmittingOn = id;
      if (!already) playPttEdge('down');
      this.changed();
      return true;
    }
    if (this.transmittingOn !== id || this.tail.running) return false;
    playPttEdge('up');
    const result = await this.tail.run(this.release, () => {
      this.playRogerIntoMix();
      if (this.release.rogerLocal) playRogerLocal();
    });
    if (result !== 'done') return false;
    const live = id ? this.slots.get(id) : undefined;
    if (live?.mic) await live.mic.mute().catch(() => undefined);
    if (this.transmittingOn === id) this.transmittingOn = null;
    this.changed();
    return false;
  }

  async dispose() { await Promise.all([...this.slots.keys()].map((id) => this.untune(id))); this.micTrack?.stop(); await this.ctx.close(); }
}
