import { useCallback, useEffect, useRef, useState } from 'react';
import { stepVoiceGate } from '../../shared/voiceGate';
import type { RadioControl } from './lib/radioEngine';

/** Voice activation must not call getUserMedia on load. A click or key in this document is the gesture. */
let gestureThisDocument = false;
function rememberGesture(): void { gestureThisDocument = true; }
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', rememberGesture);
  window.addEventListener('keydown', rememberGesture);
}

/** In-page push-to-talk, voice activation, and the Chromium headset mute toggle. */
export function useTalk(opts: {
  enabled: boolean;
  engine: RadioControl;
  talkKey: string;
  mode: 'hold' | 'voice';
  sensitivity: number;
  releaseMs: number;
  /** Set while a phone or the helper is holding the mic, so leaving the tab does not cut that off. */
  externalDown?: { current: boolean };
}) {
  const mutedRef = useRef(false);
  const pageHeld = useRef(false);
  const [hardwareMuted, setHardwareMuted] = useState(false);
  const engine = opts.engine;
  const externalDown = opts.externalDown;

  const release = useCallback(() => { void engine.ptt(false); }, [engine]);
  const releasePage = useCallback(() => {
    if (!pageHeld.current) return;
    pageHeld.current = false;
    release();
  }, [release]);

  useEffect(() => {
    if (!opts.enabled || opts.mode !== 'hold') return;
    const typing = (e: Event) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    const down = (e: KeyboardEvent) => {
      if (e.repeat || typing(e) || e.code !== opts.talkKey || mutedRef.current || document.hidden || externalDown?.current) return;
      e.preventDefault();
      pageHeld.current = true;
      void engine.unlock().then(() => engine.ptt(true));
    };
    const up = (e: KeyboardEvent) => { if (e.code === opts.talkKey) releasePage(); };
    const stop = () => releasePage();
    const vis = () => { if (document.hidden) releasePage(); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', stop);
    document.addEventListener('visibilitychange', vis);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', stop);
      document.removeEventListener('visibilitychange', vis);
      releasePage();
    };
  }, [opts.enabled, opts.mode, opts.talkKey, engine, releasePage, externalDown]);

  useEffect(() => {
    if (!opts.enabled || opts.mode !== 'voice') return;
    let open = false;
    let belowSince: number | null = null;
    let started = false;
    let stop = () => {};
    const start = () => {
      if (started) return;
      started = true;
      void engine.unlock();
      stop = engine.monitorMic((rms) => {
        if (externalDown?.current) return;
        if (mutedRef.current || document.hidden) {
          if (open) { open = false; belowSince = null; release(); }
          return;
        }
        const next = stepVoiceGate({ open, rms, sensitivity: opts.sensitivity, releaseMs: opts.releaseMs, belowSince, now: performance.now() });
        belowSince = next.belowSince;
        if (next.open !== open) { open = next.open; void engine.ptt(open); }
      });
    };
    if (gestureThisDocument) start();
    else {
      window.addEventListener('pointerdown', start);
      window.addEventListener('keydown', start);
    }
    return () => {
      window.removeEventListener('pointerdown', start);
      window.removeEventListener('keydown', start);
      stop();
      release();
    };
  }, [opts.enabled, opts.mode, opts.sensitivity, opts.releaseMs, engine, release, externalDown]);

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
    if (!opts.enabled || opts.mode !== 'hold' || mutedRef.current || externalDown?.current) return;
    pageHeld.current = true;
    void engine.unlock().then(() => engine.ptt(true));
  };
  const pointerUp = () => releasePage();

  return { hardwareMuted, pointerDown, pointerUp };
}
