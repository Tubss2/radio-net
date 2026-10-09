import { describe, expect, it } from 'vitest';
import { describePttMode } from './pttMode';

describe('describePttMode', () => {
  it('names the in-window mode, then a linked phone or helper', () => {
    expect(describePttMode({ talkMode: 'hold', talkLabel: 'Space', phoneLinked: false, helperLinked: false }))
      .toBe('Current: hold Space while this window is focused');
    expect(describePttMode({ talkMode: 'voice', talkLabel: 'Space', phoneLinked: false, helperLinked: false }))
      .toBe('Current: open mic in this window');
    expect(describePttMode({ talkMode: 'hold', talkLabel: 'K', phoneLinked: true, helperLinked: false }))
      .toBe('Current: phone · hold K while this window is focused');
    expect(describePttMode({ talkMode: 'voice', talkLabel: 'Space', phoneLinked: true, helperLinked: true }))
      .toBe('Current: phone and Windows helper · open mic in this window');
  });
});
