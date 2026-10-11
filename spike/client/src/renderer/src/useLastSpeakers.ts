import { useEffect, useRef, useState } from 'react';
import {
  LAST_SPEAKER_TICK_MS,
  speakerKey,
  stepLastSpeakers,
  type LiveTalker,
  type SpeakerLine,
} from '../../shared/lastSpeaker';

/** Recompute fading callsigns while anyone who stopped is still on screen. */
export function useLastSpeakers(live: readonly LiveTalker[]): SpeakerLine[] {
  const liveRef = useRef(live);
  liveRef.current = live;
  const key = live.map(speakerKey).join('\n');
  const [lines, setLines] = useState<SpeakerLine[]>([]);

  useEffect(() => {
    setLines((prev) => stepLastSpeakers(prev, liveRef.current, Date.now()));
  }, [key]);

  const fading = lines.some((line) => !line.live);
  useEffect(() => {
    if (!fading) return undefined;
    const id = window.setInterval(() => {
      setLines((prev) => stepLastSpeakers(prev, liveRef.current, Date.now()));
    }, LAST_SPEAKER_TICK_MS);
    return () => window.clearInterval(id);
  }, [fading, key]);

  return lines;
}
