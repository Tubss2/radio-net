/** How long a callsign stays after that person stops transmitting. */
export const LAST_SPEAKER_MS = 6500;

/** How often a fading line's opacity is recomputed. */
export const LAST_SPEAKER_TICK_MS = 100;

/** Same cap as the overlay IPC payload. */
export const LAST_SPEAKER_CAP = 32;

export interface LiveTalker {
  name: string;
  channel: string;
  freq: string;
  channelId: string;
}

export interface SpeakerLine extends LiveTalker {
  /** True while this person is transmitting. */
  live: boolean;
  /** 1 while live, then down to 0 across LAST_SPEAKER_MS. */
  opacity: number;
  /** When the transmission ended. Null while live. */
  stoppedAt: number | null;
}

export function speakerKey(t: Pick<LiveTalker, 'channelId' | 'name'>): string {
  return `${t.channelId}\0${t.name}`;
}

/** Remote names, plus the local callsign on the channel they are transmitting on. */
export function liveTalkers(
  tuned: readonly { speakers: readonly string[]; channel: { id: string; name: string; freq: string } }[],
  transmittingOn: string | null,
  callsign: string,
): LiveTalker[] {
  const out: LiveTalker[] = [];
  for (const row of tuned) {
    const names = [...row.speakers];
    if (transmittingOn === row.channel.id && callsign && !names.includes(callsign)) names.unshift(callsign);
    for (const name of names) {
      out.push({ name, channel: row.channel.name, freq: row.channel.freq, channelId: row.channel.id });
    }
  }
  return out;
}

export function linesForChannel(lines: readonly SpeakerLine[], channelId: string): SpeakerLine[] {
  return lines.filter((line) => line.channelId === channelId);
}

/**
 * Keep everyone who is talking, and keep anyone who just stopped until the fade ends.
 * A person who talks again is live immediately. Over the cap, live lines win, then the newest fades.
 */
export function stepLastSpeakers(
  prev: readonly SpeakerLine[],
  live: readonly LiveTalker[],
  now: number,
  fadeMs = LAST_SPEAKER_MS,
): SpeakerLine[] {
  const liveKeys = new Set(live.map(speakerKey));
  const next: SpeakerLine[] = live.map((t) => ({ ...t, live: true, opacity: 1, stoppedAt: null }));
  for (const line of prev) {
    if (liveKeys.has(speakerKey(line))) continue;
    const stoppedAt = line.stoppedAt ?? now;
    const elapsed = Math.max(0, now - stoppedAt);
    if (elapsed >= fadeMs) continue;
    next.push({
      name: line.name,
      channel: line.channel,
      freq: line.freq,
      channelId: line.channelId,
      live: false,
      opacity: 1 - elapsed / fadeMs,
      stoppedAt,
    });
  }
  return capSpeakers(next);
}

function capSpeakers(lines: SpeakerLine[]): SpeakerLine[] {
  if (lines.length <= LAST_SPEAKER_CAP) return lines;
  const talking = lines.filter((line) => line.live);
  const fading = lines
    .filter((line) => !line.live)
    .sort((a, b) => (b.stoppedAt ?? 0) - (a.stoppedAt ?? 0));
  return [...talking, ...fading].slice(0, LAST_SPEAKER_CAP);
}
