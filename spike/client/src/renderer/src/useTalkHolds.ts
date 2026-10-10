import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { emptyTalkHolds, reduceTalk, talkChannel, type TalkHolds, type TalkInput, type TalkSource } from '../../shared/talkHolds';
import type { RadioControl } from './lib/radioEngine';

/** Applies the shared hold set to the radio. The mic opens when the set becomes non-empty and closes when it empties. */
export function useTalkHolds(engine: RadioControl): TalkHolds {
  const state = useRef(emptyTalkHolds());
  const engineRef = useRef(engine);
  engineRef.current = engine;
  const [notice, setNotice] = useState<string | null>(null);

  const apply = useCallback((input: TalkInput) => {
    const prev = state.current;
    const decision = reduceTalk(prev, input);
    state.current = decision.state;
    if (decision.state.notice !== prev.notice) setNotice(decision.state.notice);
    if (decision.mic === true) {
      const channel = decision.channelId ?? undefined;
      void engineRef.current.unlock().then(() => engineRef.current.ptt(true, channel));
    } else if (decision.mic === false) {
      void engineRef.current.ptt(false, talkChannel(prev) ?? undefined);
    }
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => apply({ type: 'tick', now: Date.now() }), 1000);
    return () => window.clearInterval(id);
  }, [apply]);

  const down = useCallback((source: TalkSource, channelId?: string) => {
    apply({ type: 'down', source, channelId, now: Date.now() });
  }, [apply]);
  const up = useCallback((source: TalkSource) => apply({ type: 'up', source, now: Date.now() }), [apply]);
  const drop = useCallback((source: TalkSource) => apply({ type: 'drop', source, now: Date.now() }), [apply]);
  const blur = useCallback(() => apply({ type: 'blur', now: Date.now() }), [apply]);
  const dismiss = useCallback(() => apply({ type: 'dismiss', now: Date.now() }), [apply]);

  return useMemo(() => ({ down, up, drop, blur, notice, dismiss }), [down, up, drop, blur, notice, dismiss]);
}
