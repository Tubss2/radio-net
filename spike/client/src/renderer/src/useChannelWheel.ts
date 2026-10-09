import { useCallback, useEffect, useRef, useState } from 'react';
import {
  applyWheelInput,
  buildSegments,
  emptyWheel,
  onWheelKey,
  scrollSteps,
  slotsFromTuned,
  type WheelInput,
  type WheelIntent,
  type WheelModel,
  type WheelSegmentView,
} from '../../shared/radialWheel';
import type { WheelView } from '../../shared/types';
import { inElectron } from './bridge';
import type { ChannelInfo } from './lib/api';
import type { RadioControl } from './lib/radioEngine';

/**
 * Wheel state lives next to the radio engine (the overlay window is only a view).
 * Opening snapshots the tuned channels, lowest frequency first, and that order stays
 * put until the wheel closes so a segment doesn't jump under the cursor.
 * Frequency changes reconcile to the engine as a set, debounced, so a fast scroll
 * doesn't leave a stale room connected. Transmit, mute and volume apply immediately.
 */
export function useChannelWheel(engine: RadioControl, channels: ChannelInfo[]) {
  const engineRef = useRef(engine);
  engineRef.current = engine;
  const channelsRef = useRef(channels);
  channelsRef.current = channels;

  const [model, setModel] = useState<WheelModel>(emptyWheel);
  const modelRef = useRef(model);
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  const latchedRef = useRef(false);
  const dirtyRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const genRef = useRef(0);
  const aliveRef = useRef(true);

  const commit = (next: WheelModel) => {
    modelRef.current = next;
    setModel(next);
  };

  const dials = () => channelsRef.current.map((c) => ({ id: c.id, freqKHz: c.freqKHz, name: c.name }));

  const reconcile = async () => {
    if (!aliveRef.current) return;
    dirtyRef.current = false;
    const my = ++genRef.current;
    const engineNow = engineRef.current;
    const snapshot = modelRef.current.slots.filter((s) => s.channelId);
    const want = new Set(snapshot.map((s) => s.channelId!));
    for (const t of [...engineNow.tuned]) {
      if (want.has(t.channel.id)) continue;
      await engineNow.untune(t.channel.id);
      if (my !== genRef.current || !aliveRef.current) return;
    }
    for (const s of snapshot) {
      const ch = channelsRef.current.find((c) => c.id === s.channelId);
      if (!ch) continue;
      if (!engineNow.tuned.some((t) => t.channel.id === ch.id)) {
        try { await engineNow.tune(ch); } catch { continue; }
        if (my !== genRef.current || !aliveRef.current) return;
      }
      const latest = modelRef.current.slots.find((x) => x.channelId === ch.id);
      engineNow.setVolume(ch.id, latest?.volume ?? s.volume);
      engineNow.setMuted(ch.id, latest?.muted ?? s.muted);
    }
  };

  const scheduleReconcile = () => {
    dirtyRef.current = true;
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => { timerRef.current = null; void reconcile(); }, 80);
  };

  const applyIntents = (intents: WheelIntent[]) => {
    let tune = false;
    for (const intent of intents) {
      if (intent.type === 'set-tx') engineRef.current.setTx(intent.channelId);
      else if (intent.type === 'set-muted') engineRef.current.setMuted(intent.channelId, intent.muted);
      else if (intent.type === 'set-volume') engineRef.current.setVolume(intent.channelId, intent.volume);
      else tune = true;
    }
    if (tune) scheduleReconcile();
  };

  const apply = (input: WheelInput) => {
    const { model: next, intents } = applyWheelInput(modelRef.current, input, dials(), engineRef.current.txId);
    commit(next);
    applyIntents(intents);
  };

  const openWheel = () => {
    genRef.current += 1;
    const slots = slotsFromTuned(engineRef.current.tuned.map((t) => ({
      freqKHz: t.channel.freqKHz,
      channelId: t.channel.id,
      volume: t.volume,
      muted: t.muted,
      canTransmit: t.canTransmit,
    })));
    commit({ ...emptyWheel(), slots });
    openRef.current = true;
    setOpen(true);
  };

  const closeWheel = () => {
    const flush = dirtyRef.current;
    if (timerRef.current != null) { window.clearTimeout(timerRef.current); timerRef.current = null; }
    const { model: next } = applyWheelInput(modelRef.current, { type: 'close' }, dials(), engineRef.current.txId);
    commit(next);
    openRef.current = false;
    latchedRef.current = false;
    setOpen(false);
    if (flush && aliveRef.current) void reconcile();
  };

  const onKey = useCallback((down: boolean, heldMs: number) => {
    const next = onWheelKey(
      { open: openRef.current, latched: latchedRef.current, adding: modelRef.current.adding },
      { down, heldMs },
    );
    latchedRef.current = next.latched;
    if (next.open === openRef.current) return;
    if (next.open) openWheel();
    else closeWheel();
  }, []);

  const onInput = useCallback((input: WheelInput) => {
    if (input.type === 'close') { closeWheel(); return; }
    if (!openRef.current) return;
    apply(input);
  }, []);

  const onFallbackScroll = useCallback((steps: number, shift: boolean) => {
    if (!openRef.current || !steps) return;
    apply({ type: 'scroll-fallback', steps, shift });
  }, []);

  const onNumber = useCallback((n: number) => {
    if (!openRef.current) return;
    apply({ type: 'number', n });
  }, []);

  const close = useCallback(() => { if (openRef.current) closeWheel(); }, []);

  useEffect(() => () => {
    aliveRef.current = false;
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
  }, []);

  // Browser preview has no global hook. G opens the wheel; hold G and scroll away from the ring to retune.
  useEffect(() => {
    if (inElectron) return;
    const downAt = { t: null as number | null };
    const kd = (e: KeyboardEvent) => {
      if (e.code !== 'KeyG' || e.repeat) return;
      if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) e.preventDefault();
      if (downAt.t != null) return;
      downAt.t = performance.now();
      onKey(true, 0);
    };
    const ku = (e: KeyboardEvent) => {
      if (e.code !== 'KeyG' || downAt.t == null) return;
      const held = performance.now() - downAt.t;
      downAt.t = null;
      onKey(false, held);
    };
    const wheel = (e: WheelEvent) => {
      if (downAt.t == null) return;
      const t = e.target instanceof Element ? e.target : null;
      if (t?.closest('.radial, .radial-add')) return;
      e.preventDefault();
      const steps = scrollSteps(e.deltaY);
      if (steps) onFallbackScroll(steps, e.shiftKey);
    };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('wheel', wheel, { passive: false });
    return () => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('wheel', wheel);
    };
  }, [onKey, onFallbackScroll]);

  const segments: WheelSegmentView[] = buildSegments(model, (slot) => {
    const tuned = engine.tuned.find((t) => t.channel.id === slot.channelId);
    const ch = channels.find((c) => c.id === slot.channelId);
    return {
      name: ch?.name ?? tuned?.channel.name ?? '',
      live: tuned?.status === 'live',
      transmitting: slot.channelId != null && engine.txId === slot.channelId,
    };
  });

  const view: WheelView = {
    open,
    segments: open ? segments : [],
    adding: open && model.adding,
    addError: open ? model.addError : '',
  };

  return { open, segments, adding: model.adding, addError: model.addError, view, onKey, onInput, onFallbackScroll, onNumber, close };
}
