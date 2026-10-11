import { useCallback, useEffect, useRef, useState } from 'react';
import type { TalkHolds } from '../../shared/talkHolds';
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
  holds: TalkHolds;
}) {
  const mutedRef = useRef(false);
  const [hardwareMuted, setHardwareMuted] = useState(false);
  const engine = opts.engine;
  const holds = opts.holds;

  const releasePage = useCallback(() => { holds.up('page'); }, [holds]);

  useEffect(() => {
    if (!opts.enabled || opts.mode !== 'hold') return;
    const typing = (e: Event) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    const down = (e: KeyboardEvent) => {
      if (e.repeat || typing(e) || e.code !== opts.talkKey || mutedRef.current || document.hidden) return;
      e.preventDefault();
      holds.down('page');
    };
    const up = (e: KeyboardEvent) => { if (e.code === opts.talkKey) releasePage(); };
    const stop = () => holds.blur();
    const vis = () => { if (document.hidden) holds.blur(); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', stop);
    document.addEventListener('visibilitychange', vis);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', stop);
      document.removeEventListener('visibilitychange', vis);
      holds.blur();
    };
  }, [opts.enabled, opts.mode, opts.talkKey, holds.down, holds.up, holds.blur]);

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
        if (mutedRef.current || document.hidden) {
          if (open) { open = false; belowSince = null; holds.up('voice'); }
          return;
        }
        const next = stepVoiceGate({ open, rms, sensitivity: opts.sensitivity, releaseMs: opts.releaseMs, belowSince, now: performance.now() });
        belowSince = next.belowSince;
        if (next.open !== open) {
          open = next.open;
          if (open) holds.down('voice');
          else holds.up('voice');
        }
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
      holds.up('voice');
    };
  }, [opts.enabled, opts.mode, opts.sensitivity, opts.releaseMs, engine, holds.down, holds.up]);

  useEffect(() => {
    if (!opts.enabled) return;
    const session = navigator.mediaSession as MediaSession & { setMicrophoneActive?: (active: boolean) => void };
    const toggle = () => {
      mutedRef.current = !mutedRef.current;
      setHardwareMuted(mutedRef.current);
      if (mutedRef.current) holds.blur();
      try { session.setMicrophoneActive?.(!mutedRef.current); } catch { /* this browser has no mic session */ }
    };
    try { session.setActionHandler('togglemicrophone' as MediaSessionAction, toggle); } catch { /* not supported */ }
    return () => { try { session.setActionHandler('togglemicrophone' as MediaSessionAction, null); } catch { /* not supported */ } };
  }, [opts.enabled, holds.blur]);

  const pointerDown = () => {
    if (!opts.enabled || opts.mode !== 'hold' || mutedRef.current) return;
    holds.down('pointer');
  };
  const pointerUp = () => { holds.up('pointer'); };

  return { hardwareMuted, pointerDown, pointerUp };
}
