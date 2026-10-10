import { describe, expect, it } from 'vitest';
import {
  LAST_SPEAKER_CAP,
  LAST_SPEAKER_MS,
  linesForChannel,
  liveTalkers,
  stepLastSpeakers,
  type LiveTalker,
  type SpeakerLine,
} from './lastSpeaker';

const cmd = { id: 'cmd', name: 'Command', freq: '59.5' };
const arty = { id: 'arty', name: 'Arty', freq: '41.5' };

function talker(over: Partial<LiveTalker> = {}): LiveTalker {
  return { name: 'Rhys', channel: 'Command', freq: '59.5', channelId: 'cmd', ...over };
}

describe('last speaker fade', () => {
  it('holds a live talker at full strength', () => {
    const lines = stepLastSpeakers([], [talker()], 1_000);
    expect(lines).toEqual([
      { name: 'Rhys', channel: 'Command', freq: '59.5', channelId: 'cmd', live: true, opacity: 1, stoppedAt: null },
    ]);
  });

  it('starts the fade when they stop and drops them at the end', () => {
    const live = stepLastSpeakers([], [talker()], 1_000);
    const stopped = stepLastSpeakers(live, [], 5_000);
    expect(stopped[0]).toMatchObject({ live: false, stoppedAt: 5_000, opacity: 1 });
    const mid = stepLastSpeakers(stopped, [], 5_000 + LAST_SPEAKER_MS / 2);
    expect(mid[0].opacity).toBeCloseTo(0.5);
    expect(stepLastSpeakers(mid, [], 5_000 + LAST_SPEAKER_MS)).toEqual([]);
  });

  it('clears the fade if they transmit again', () => {
    const fading: SpeakerLine[] = [{ ...talker(), live: false, opacity: 0.4, stoppedAt: 1_000 }];
    const again = stepLastSpeakers(fading, [talker()], 4_000);
    expect(again).toEqual([{ ...talker(), live: true, opacity: 1, stoppedAt: null }]);
  });

  it('fades one channel without clearing another', () => {
    const both = stepLastSpeakers([], [talker(), talker({ name: 'Sam', channel: 'Arty', freq: '41.5', channelId: 'arty' })], 0);
    const next = stepLastSpeakers(both, [talker()], 100);
    expect(linesForChannel(next, 'cmd').map((l) => l.live)).toEqual([true]);
    expect(linesForChannel(next, 'arty')[0]).toMatchObject({ name: 'Sam', live: false, stoppedAt: 100 });
  });

  it('keeps live lines when the list is over the cap', () => {
    const live = Array.from({ length: LAST_SPEAKER_CAP }, (_, i) => talker({ name: `L${i}` }));
    const fading: SpeakerLine[] = [{ ...talker({ name: 'Old' }), live: false, opacity: 0.2, stoppedAt: 1 }];
    const next = stepLastSpeakers(fading, live, 50);
    expect(next).toHaveLength(LAST_SPEAKER_CAP);
    expect(next.every((line) => line.live)).toBe(true);
    expect(next.some((line) => line.name === 'Old')).toBe(false);
  });

  it('adds the local callsign only on the channel they are transmitting on', () => {
    const tuned = [
      { speakers: ['Rhys'], channel: cmd },
      { speakers: [] as string[], channel: arty },
    ];
    expect(liveTalkers(tuned, 'arty', 'Toby').map((t) => [t.channelId, t.name])).toEqual([
      ['cmd', 'Rhys'],
      ['arty', 'Toby'],
    ]);
    expect(liveTalkers([{ speakers: ['Toby'], channel: cmd }], 'cmd', 'Toby')).toHaveLength(1);
    expect(liveTalkers(tuned, null, 'Toby').some((t) => t.name === 'Toby')).toBe(false);
  });
});
