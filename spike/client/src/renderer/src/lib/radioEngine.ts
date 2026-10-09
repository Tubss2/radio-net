import {
  type LocalTrackPublication, type RemoteTrack, Room, RoomEvent, Track, createLocalAudioTrack, DisconnectReason,
} from 'livekit-client';
import { RECONNECTING } from '../../../shared/net';
import { isReconnectError, type Api, type ChannelInfo } from './api';
import { clientLog } from './clientLog';
import { resolveLivekitUrl } from './livekitUrl';

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
  cycle(): void;
  ptt(down: boolean, channelId?: string): Promise<void>;
  dispose(): Promise<void>;
}

interface Slot {
  info: TunedChannel;
  room: Room;
  gain: GainNode;
  panner: StereoPannerNode;
  mic?: LocalTrackPublication;
  sinks: HTMLAudioElement[];
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
      room, gain, panner, sinks: [],
      info: { channel, status: 'connecting', canTransmit: grant.canTransmit, volume: 1, pan: 0, muted: false, speakers: [], listeners: 0 },
    };
    this.slots.set(channel.id, slot);
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
      slot.gain.disconnect();
      void room.disconnect();
      clientLog('livekit', `connect ${channel.freq} failed`);
      this.changed();
      if (isReconnectError(err)) throw new Error(RECONNECTING);
      throw err;
    }
    clientLog('livekit', `connected ${channel.freq}`);
    slot.info.status = 'live';
    slot.info.listeners = room.numParticipants;
    if (grant.canTransmit) {
      const pub = await room.localParticipant.publishTrack((await this.mic()).clone(), {
        source: Track.Source.Microphone, dtx: true, red: true, name: 'mic',
      });
      await pub.mute();
      slot.mic = pub;
      if (!this.txId) this.txId = channel.id;
    }
    this.changed();
  }

  /** Remove the slot from the radio immediately. The room disconnect can finish afterwards. */
  private takeSlot(channelId: string): Slot | undefined {
    const slot = this.slots.get(channelId);
    if (!slot) return;
    this.slots.delete(channelId);
    slot.sinks.forEach((e) => { e.srcObject = null; });
    try { slot.gain.disconnect(); } catch { /* already torn down */ }
    const wasTx = this.txId === channelId;
    if (wasTx) this.txId = null;
    if (this.transmittingOn === channelId) this.transmittingOn = null;
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

  setTx(id: string) { if (this.slots.get(id)?.info.canTransmit) { this.txId = id; this.blip(880); this.changed(); } }

  /** Cycle key: move TX to the next tuned channel (by frequency). */
  cycle() {
    const ids = this.tuned.filter((t) => t.canTransmit && t.status !== 'gone').map((t) => t.channel.id);
    if (!ids.length) { this.txId = null; this.changed(); return; }
    const next = ids[(ids.indexOf(this.txId ?? '') + 1) % ids.length];
    this.setTx(next);
  }

  /** PTT on the TX channel, or on a specific channel (direct per-channel key). */
  async ptt(down: boolean, channelId?: string) {
    const id = channelId ?? this.txId;
    const slot = id ? this.slots.get(id) : undefined;
    if (!slot?.mic) return;
    if (down) {
      if (this.transmittingOn && this.transmittingOn !== id) await this.ptt(false, this.transmittingOn);
      this.transmittingOn = id!;
      await slot.mic.unmute();
      this.blip(1200);
    } else if (this.transmittingOn === id) {
      await slot.mic.mute();
      this.transmittingOn = null;
      this.blip(700);
    }
    this.changed();
  }

  /** Short confirmation tone (not a radio effect). */
  private blip(hz: number) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.value = hz;
    g.gain.setValueAtTime(0.06, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.07);
    o.connect(g).connect(this.ctx.destination);
    o.start(); o.stop(this.ctx.currentTime + 0.08);
  }

  async dispose() { await Promise.all([...this.slots.keys()].map((id) => this.untune(id))); this.micTrack?.stop(); await this.ctx.close(); }
}
