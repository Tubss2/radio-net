import { describe, expect, it } from 'vitest';
import { describePttMode, pttModeView } from './pttMode';

describe('describePttMode', () => {
  it('names the active option, with a linked phone ahead of the helper', () => {
    expect(describePttMode({ talkMode: 'hold', talkLabel: 'Space', phoneLinked: false, helperLinked: false }))
      .toBe('PTT: Browser (Space)');
    expect(pttModeView({ talkMode: 'hold', talkLabel: 'Space', phoneLinked: false, helperLinked: false }))
      .toMatchObject({ option: 'Browser (Space)', disconnect: null, live: true });
    expect(describePttMode({ talkMode: 'voice', talkLabel: 'Space', phoneLinked: false, helperLinked: false }))
      .toBe('PTT: Voice activation');
    expect(describePttMode({ talkMode: 'hold', talkLabel: 'K', phoneLinked: true, helperLinked: false }))
      .toBe('PTT: Phone linked');
    expect(pttModeView({ talkMode: 'hold', talkLabel: 'K', phoneLinked: true, helperLinked: true }))
      .toMatchObject({ label: 'PTT: Phone linked', disconnect: 'phone', live: true });
    expect(describePttMode({ talkMode: 'hold', talkLabel: 'Space', phoneLinked: false, helperLinked: true }))
      .toBe('PTT: Helper connected (F1)');
    expect(pttModeView({ talkMode: 'voice', talkLabel: 'Space', phoneLinked: false, helperLinked: true }).disconnect)
      .toBe('helper');
  });
});
