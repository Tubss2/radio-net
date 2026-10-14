import {
  type LocalTrackPublication, type RemoteTrack, Room, RoomEvent, Track, createLocalAudioTrack, DisconnectReason,
} from 'livekit-client';
import { ALL_CALL_ATTR } from '../../../shared/allCall';
import { RECONNECTING } from '../../../shared/net';
import { pickTransmitId } from '../../../shared/transmit';
import { isReconnectError, type Api, type ChannelInfo } from './api';
import { clientLog } from './clientLog';
import { resolveLivekitUrl } from './livekitUrl';
import { effectiveFilter, parseChannelFilter, parseRadioFilter, transmissionCueEdges, type RadioFilterPreset } from '../../../shared/radioFilter';
import { ReleaseTail } from '../../../shared/roger';
import { RADIO_WORKLET, codec2Bytes, radioWorkletUrl } from '../audio/radioVoice';
import { playPttEdge, playTransmissionCue, playTxChange } from './uiSounds';
import { sampleFromStats, type RtcSample } from '../../../shared/voiceDiag';
import { collectAudioStats } from './roomStats';

/** Counts the radio keeps for the Send diagnostics button. No audio leaves through this. */
export interface RadioDiag {
  noteReconnect(freq: string): void;
  noteDisconnect(freq: string): void;
  notePtt(ok: boolean): void;
  noteSample(freq: string, sample: RtcSample): void;
}

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
  /** Null follows this person's default radio filter. */
  filter: RadioFilterPreset | null;
  speakers: string[]; // display names talking now
  listeners: number;
  /** Remote all-call name heard in this room, if the server marked one. */
  allCallFrom: string | null;
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
  /** Profile default for received voice. Clean bypasses the filter. */
  setRadioFilter(preset: RadioFilterPreset): void;
  /** Null clears the override and follows the profile default. */
  setChannelFilter(id: string, preset: RadioFilterPreset | null): void;
  setTx(id: string): void;
  /** A tuned channel that can transmit becomes the talk channel when none is chosen. */
  ensureTx(): void;
  /** Step the talk channel. Positive moves to the next tuned channel, negative to the previous. */
  cycle(step?: 1 | -1): void;
  /** True only after this call left the microphone unmuted. */
  ptt(down: boolean, channelId?: string): Promise<boolean>;
  /** True while this radio is holding admin all-call. */
  readonly allCalling: boolean;
  /** Name of a remote all-call, from the server attribute on a forwarded participant. */
  readonly allCallFrom: string | null;
  /**
   * Open the transmit mic for all-call, or close it when the talk key is not also held.
   * The API has to accept the all-call before the UI calls this.
   */
  holdAllCall(on: boolean): Promise<boolean>;
  /**
   * Hang applied the next time push-to-talk releases.
   * `roger` plays other people's transmission cues. `rogerLocal` plays this radio's own.
   */
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

interface RemoteVoice {
  identity: string;
  source: MediaStreamAudioSourceNode;
  el: HTMLAudioElement;
  tap: GainNode | null;
  node: AudioWorkletNode | null;
}

interface Slot {
  info: TunedChannel;
  room: Room;
  gain: GainNode;
  panner: StereoPannerNode;
  mic?: LocalTrackPublication;
  sinks: HTMLAudioElement[];
  voices: RemoteVoice[];
  /** Remote identities LiveKit currently marks as speaking in this room. */
  activeIds: string[];
  filterGen: number;
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
  allCalling = false;
  allCallFrom: string | null = null;
  /** Talk key (or voice) is holding the mic, so releasing all-call must leave it open. */
  private micHeldByTalk = false;
  version = 0;
  onChannelDeleted?: (channelId: string) => void;
  private mix: OutgoingMix | null = null;
  private release = { hangMs: 150, roger: true, rogerLocal: false };
  private radioFilter: RadioFilterPreset = 'clean';
  private workletReady: Promise<void> | null = null;
  /** Identities we have already played a start cue for. */
  private heard: string[] = [];
  private tail = new ReleaseTail((ms) => new Promise((resolve) => { setTimeout(resolve, ms); }));
  /** Bumped on every press and release so a release during unmute can win. */
  private talkSerial = 0;
  /** True only when the latest press or release still wants the mic open. */
  private talkWantsOpen = false;

  setRelease(opts: { hangMs: number; roger: boolean; rogerLocal: boolean }) {
    this.release = { ...opts };
  }

  setRadioFilter(preset: RadioFilterPreset) {
    const next = parseRadioFilter(preset);
    if (next === this.radioFilter) return;
    this.radioFilter = next;
    for (const slot of this.slots.values()) {
      if (!slot.info.filter) this.applyFilter(slot);
    }
  }

  setChannelFilter(id: string, preset: RadioFilterPreset | null) {
    const slot = this.slots.get(id);
    if (!slot) return;
    const next = preset ? parseChannelFilter(preset) : null;
    if (slot.info.filter === next) return;
    slot.info.filter = next;
    this.applyFilter(slot);
    this.changed();
  }

  private diagTimer?: ReturnType<typeof setInterval>;

  constructor(private api: Api, private communityId: string, private diag?: RadioDiag) {
    if (!diag) return;
    this.diagTimer = setInterval(() => { void this.sampleDiag(); }, 15_000);
  }

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
      room, gain, panner, sinks: [], voices: [], activeIds: [], filterGen: 0, refreshing: false,
      info: { channel, status: 'connecting', canTransmit: grant.canTransmit, volume: 1, pan: 0, muted: false, filter: null, speakers: [], listeners: 0, allCallFrom: null },
    };
    this.slots.set(channel.id, slot);
    this.ensureTx();
    this.changed();

    room
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _publication, participant) => {
        if (track.kind !== Track.Kind.Audio) return;
        // A forwarded all-call uses the admin's own identity. Playing it back would be an echo.
        if (participant.identity === room.localParticipant.identity) return;
        // Chromium only feeds remote WebRTC audio into WebAudio if it's also attached to a (muted) element.
        const el = new Audio();
        el.srcObject = new MediaStream([track.mediaStreamTrack]);
        el.muted = true;
        void el.play().catch(() => undefined);
        slot.sinks.push(el);
        const source = this.ctx.createMediaStreamSource(new MediaStream([track.mediaStreamTrack]));
        const voice: RemoteVoice = { identity: participant.identity, source, el, tap: null, node: null };
        slot.voices.push(voice);
        source.connect(gain);
        void this.wireVoice(slot, voice);
        this.noteAllCall();
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, _publication, participant) => {
        if (track.kind !== Track.Kind.Audio) return;
        const index = slot.voices.findIndex((voice) => voice.identity === participant.identity && voice.el.srcObject);
        const voice = index >= 0 ? slot.voices[index] : undefined;
        if (!voice) return;
        slot.voices.splice(index, 1);
        this.detachVoice(voice);
        voice.el.srcObject = null;
        const sink = slot.sinks.indexOf(voice.el);
        if (sink >= 0) slot.sinks.splice(sink, 1);
      })
      .on(RoomEvent.ParticipantAttributesChanged, () => { this.noteAllCall(); })
      .on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        const remote = speakers.filter((p) => p !== room.localParticipant);
        slot.activeIds = remote.map((p) => p.identity);
        slot.info.speakers = remote.map((p) => p.name || p.identity);
        for (const voice of slot.voices) {
          voice.node?.port.postMessage({ type: 'carrier', on: slot.activeIds.includes(voice.identity) });
        }
        this.syncCues();
        this.changed();
      })
      .on(RoomEvent.ParticipantConnected, () => { slot.info.listeners = room.numParticipants; this.noteAllCall(); })
      .on(RoomEvent.ParticipantDisconnected, () => { slot.info.listeners = room.numParticipants; this.noteAllCall(); })
      .on(RoomEvent.Reconnecting, () => {
        slot.info.status = 'reconnecting';
        this.diag?.noteReconnect(channel.freq);
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
        this.diag?.noteDisconnect(channel.freq);
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

  /** The published voice is the treated mic only. Transmission cues stay on each listener's machine. */
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

  private ensureWorklet(): Promise<void> {
    if (!this.workletReady) this.workletReady = this.ctx.audioWorklet.addModule(radioWorkletUrl());
    return this.workletReady;
  }

  private applyFilter(slot: Slot) {
    slot.filterGen += 1;
    for (const voice of slot.voices) void this.wireVoice(slot, voice);
  }

  private detachVoice(voice: RemoteVoice) {
    try { voice.source.disconnect(); } catch { /* already disconnected */ }
    try { voice.tap?.disconnect(); } catch { /* already disconnected */ }
    try { voice.node?.disconnect(); } catch { /* already disconnected */ }
    voice.node?.port.postMessage({ type: 'carrier', on: false });
    voice.tap = null;
    voice.node = null;
  }

  /** Insert or remove the listener filter without touching the published mic. */
  private async wireVoice(slot: Slot, voice: RemoteVoice) {
    const preset = effectiveFilter(slot.info.filter, this.radioFilter);
    const gen = slot.filterGen;
    this.detachVoice(voice);
    if (preset === 'clean' || this.ctx.state === 'closed') {
      try { voice.source.connect(slot.gain); } catch { /* the source can already be closed */ }
      return;
    }
    try {
      await this.ensureWorklet();
    } catch (err) {
      clientLog('livekit', `filter ${(err as Error).message}`);
      try { voice.source.connect(slot.gain); } catch { /* closed */ }
      return;
    }
    if (gen !== slot.filterGen || !this.slots.has(slot.info.channel.id)) return;
    const tap = this.ctx.createGain();
    tap.channelCount = 1;
    tap.channelCountMode = 'explicit';
    const node = new AudioWorkletNode(this.ctx, RADIO_WORKLET, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: 'explicit',
    });
    voice.tap = tap;
    voice.node = node;
    voice.source.connect(tap);
    tap.connect(node);
    node.connect(slot.gain);
    node.port.postMessage({ type: 'preset', preset });
    node.port.postMessage({ type: 'carrier', on: slot.activeIds.includes(voice.identity) });
    if (preset === 'digital') {
      void codec2Bytes().then((bytes) => {
        if (voice.node === node) node.port.postMessage({ type: 'wasm', bytes: bytes.slice(0) });
      }).catch((err) => clientLog('livekit', `codec2 ${(err as Error).message}`));
    }
  }

  /** One start or end cue per change in who is talking, across every tuned channel. */
  private syncCues() {
    const seen = new Set<string>();
    const next: string[] = [];
    for (const slot of this.slots.values()) {
      for (const id of slot.activeIds) {
        if (seen.has(id)) continue;
        seen.add(id);
        next.push(id);
      }
    }
    if (this.release.roger) {
      const edges = transmissionCueEdges(this.heard, next);
      if (edges.start.length) playTransmissionCue('start');
      if (edges.end.length) playTransmissionCue('end');
    }
    this.heard = next;
  }

  private async publishMutedMic(slot: Slot): Promise<LocalTrackPublication> {
    const pub = await slot.room.localParticipant.publishTrack(await this.outgoingTrack(), {
      source: Track.Source.Microphone, dtx: true, red: true, name: 'mic',
    });
    await pub.mute();
    slot.mic = pub;
    return pub;
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
      let mic: LocalTrackPublication | undefined;
      if (grant.canTransmit) {
        try {
          mic = await this.publishMutedMic(slot);
        } catch (err) {
          clientLog('livekit', `mic ${slot.info.channel.freq} ${(err as Error).message}`);
        }
      }
      if (wasTalking && mic) {
        // All-call keeps the mic open without pretending the talk key is held.
        if (this.allCalling && channelId === this.txId) await mic.unmute();
        else await this.ptt(true, channelId);
      }
      this.changed();
      this.scheduleRefresh(channelId);
    } catch (err) {
      if (isReconnectError(err)) {
        slot.info.status = 'reconnecting';
        this.diag?.noteReconnect(slot.info.channel.freq);
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
    slot.voices.forEach((voice) => this.detachVoice(voice));
    slot.sinks.forEach((e) => { e.srcObject = null; });
    this.syncCues();
    try { slot.gain.disconnect(); } catch { /* already torn down */ }
    const wasTx = this.txId === channelId;
    if (wasTx) {
      this.txId = null;
      this.allCalling = false;
    }
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
    if (this.allCalling && id !== this.txId) return false;
    const slot = id ? this.slots.get(id) : undefined;
    if (down) {
      this.tail.cancel();
      if (!slot?.mic) {
        this.diag?.notePtt(false);
        return false;
      }
      if (this.transmittingOn && this.transmittingOn !== id) await this.ptt(false, this.transmittingOn);
      const serial = ++this.talkSerial;
      this.talkWantsOpen = true;
      const already = this.transmittingOn === id;
      try {
        await slot.mic.unmute();
      } catch (err) {
        clientLog('livekit', `unmute ${slot.info.channel.freq} ${(err as Error).message}`);
        this.diag?.notePtt(false);
        if (this.transmittingOn === id) this.transmittingOn = null;
        this.changed();
        return false;
      }
      if (serial !== this.talkSerial) {
        if (!this.talkWantsOpen && !this.allCalling) {
          await slot.mic.mute().catch(() => undefined);
          if (this.transmittingOn === id) this.transmittingOn = null;
          this.changed();
        }
        return false;
      }
      this.micHeldByTalk = true;
      this.transmittingOn = id;
      if (!already) {
        this.diag?.notePtt(true);
        playPttEdge('down');
        if (this.release.rogerLocal) playTransmissionCue('start', { own: true });
      }
      this.changed();
      return true;
    }
    this.talkSerial++;
    this.talkWantsOpen = false;
    if (this.allCalling && id === this.txId) {
      this.micHeldByTalk = false;
      this.changed();
      return false;
    }
    if (this.transmittingOn !== id || this.tail.running) return false;
    this.micHeldByTalk = false;
    playPttEdge('up');
    const result = await this.tail.run(this.release.hangMs);
    if (result !== 'done') return false;
    if (this.release.rogerLocal) playTransmissionCue('end', { own: true });
    const live = id ? this.slots.get(id) : undefined;
    if (live?.mic) await live.mic.mute().catch(() => undefined);
    if (this.transmittingOn === id) this.transmittingOn = null;
    this.changed();
    return false;
  }

  async holdAllCall(on: boolean): Promise<boolean> {
    if (!on) {
      if (!this.allCalling) return false;
      this.allCalling = false;
      if (this.micHeldByTalk) {
        this.changed();
        return false;
      }
      const id = this.transmittingOn;
      const slot = id ? this.slots.get(id) : undefined;
      if (!slot?.mic) {
        if (this.transmittingOn) this.transmittingOn = null;
        this.changed();
        return false;
      }
      playPttEdge('up');
      const result = await this.tail.run(this.release.hangMs);
      if (result !== 'done') return false;
      if (this.release.rogerLocal) playTransmissionCue('end', { own: true });
      await slot.mic.mute().catch(() => undefined);
      if (this.transmittingOn === id) this.transmittingOn = null;
      this.changed();
      return false;
    }
    this.tail.cancel();
    const id = this.txId;
    const slot = id ? this.slots.get(id) : undefined;
    if (!slot?.mic || slot.info.status === 'gone') return false;
    if (this.transmittingOn && this.transmittingOn !== id) return false;
    const already = this.transmittingOn === id;
    try {
      await slot.mic.unmute();
    } catch (err) {
      clientLog('livekit', `all-call unmute ${slot.info.channel.freq} ${(err as Error).message}`);
      this.diag?.notePtt(false);
      return false;
    }
    this.allCalling = true;
    this.transmittingOn = id;
    if (!already) {
      this.diag?.notePtt(true);
      playPttEdge('down');
      if (this.release.rogerLocal) playTransmissionCue('start', { own: true });
    }
    this.changed();
    return true;
  }

  private async sampleDiag() {
    if (!this.diag) return;
    for (const slot of this.slots.values()) {
      try {
        const sample = sampleFromStats(await collectAudioStats(slot.room));
        this.diag.noteSample(slot.info.channel.freq, sample);
      } catch {
        // The room can close while the stats call is in flight.
      }
    }
  }

  /** Banner name for a remote all-call. The local participant is skipped so the sender does not cue on their own forward. */
  private noteAllCall() {
    let from: string | null = null;
    for (const slot of this.slots.values()) {
      const localId = slot.room.localParticipant.identity;
      for (const peer of slot.room.remoteParticipants.values()) {
        if (peer.identity === localId) continue;
        if (peer.attributes[ALL_CALL_ATTR] !== '1') continue;
        from = peer.name || peer.identity;
        break;
      }
      if (from) break;
    }
    for (const slot of this.slots.values()) slot.info.allCallFrom = from;
    this.allCallFrom = from;
    this.changed();
  }

  async dispose() {
    if (this.diagTimer) clearInterval(this.diagTimer);
    await Promise.all([...this.slots.keys()].map((id) => this.untune(id)));
    this.micTrack?.stop();
    await this.ctx.close();
  }
}
