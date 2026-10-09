import { useCallback, useEffect, useRef, useState } from 'react';
import { stepVoiceGate } from '../../shared/voiceGate';
import type { RadioControl } from './lib/radioEngine';

/** In-page push-to-talk, voice activation, and the Chromium headset mute toggle. */
export function useTalk(opts: {
  enabled: boolean;
  engine: RadioControl;
  talkKey: string;
  mode: 'hold' | 'voice';
  sensitivity: number;
  releaseMs: number;
}) {
  const mutedRef = useRef(false);
  const [hardwareMuted, setHardwareMuted] = useState(false);
  const engine = opts.engine;

  const release = useCallback(() => { void engine.ptt(false); }, [engine]);

  useEffect(() => {
    if (!opts.enabled || opts.mode !== 'hold') return;
    const typing = (e: Event) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    const down = (e: KeyboardEvent) => {
      if (e.repeat || typing(e) || e.code !== opts.talkKey || mutedRef.current || document.hidden) return;
      e.preventDefault();
      void engine.unlock().then(() => engine.ptt(true));
    };
    const up = (e: KeyboardEvent) => { if (e.code === opts.talkKey) release(); };
    const stop = () => release();
    const vis = () => { if (document.hidden) release(); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', stop);
    document.addEventListener('visibilitychange', vis);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', stop);
      document.removeEventListener('visibilitychange', vis);
      release();
    };
  }, [opts.enabled, opts.mode, opts.talkKey, engine, release]);

  useEffect(() => {
    if (!opts.enabled || opts.mode !== 'voice') return;
    let open = false;
    let belowSince: number | null = null;
    const stop = engine.monitorMic((rms) => {
      if (mutedRef.current || document.hidden) {
        if (open) { open = false; belowSince = null; release(); }
        return;
      }
      const next = stepVoiceGate({ open, rms, sensitivity: opts.sensitivity, releaseMs: opts.releaseMs, belowSince, now: performance.now() });
      belowSince = next.belowSince;
      if (next.open !== open) { open = next.open; void engine.ptt(open); }
    });
    return () => { stop(); release(); };
  }, [opts.enabled, opts.mode, opts.sensitivity, opts.releaseMs, engine, release]);

  useEffect(() => {
    if (!opts.enabled) return;
    const session = navigator.mediaSession as MediaSession & { setMicrophoneActive?: (active: boolean) => void };
    const toggle = () => {
      mutedRef.current = !mutedRef.current;
      setHardwareMuted(mutedRef.current);
      if (mutedRef.current) release();
      try { session.setMicrophoneActive?.(!mutedRef.current); } catch { /* this browser has no mic session */ }
    };
    try { session.setActionHandler('togglemicrophone' as MediaSessionAction, toggle); } catch { /* not supported */ }
    return () => { try { session.setActionHandler('togglemicrophone' as MediaSessionAction, null); } catch { /* not supported */ } };
  }, [opts.enabled, release]);

  const pointerDown = () => {
    if (!opts.enabled || opts.mode !== 'hold' || mutedRef.current) return;
    void engine.unlock().then(() => engine.ptt(true));
  };

  return { hardwareMuted, pointerDown, pointerUp: release };
}
