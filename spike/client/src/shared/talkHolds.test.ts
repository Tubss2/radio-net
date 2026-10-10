import { describe, expect, it } from 'vitest';
import { emptyTalkHolds, reduceTalk, STUCK_TALK_MS, STUCK_TALK_NOTICE, type TalkHoldState, type TalkSource } from './talkHolds';

function down(state: TalkHoldState, source: TalkSource, now: number, channelId?: string) {
  return reduceTalk(state, { type: 'down', source, now, channelId });
}
function up(state: TalkHoldState, source: TalkSource, now = 0) {
  return reduceTalk(state, { type: 'up', source, now });
}

describe('talk holds', () => {
  it('talks while any source is held and ignores a release that was not held', () => {
    const page = down(emptyTalkHolds(), 'page', 1);
    expect(page.mic).toBe(true);
    const both = down(page.state, 'phone', 2);
    expect(both.mic).toBeNull();
    expect(both.state.holds.map((hold) => hold.source)).toEqual(['page', 'phone']);
    const one = up(both.state, 'page');
    expect(one.mic).toBeNull();
    expect(one.state.holds.map((hold) => hold.source)).toEqual(['phone']);
    const none = up(one.state, 'phone');
    expect(none.mic).toBe(false);
    expect(none.state.holds).toEqual([]);
    const stray = up(none.state, 'helper');
    expect(stray.mic).toBeNull();
    expect(stray.state.holds).toEqual([]);
  });

  it('treats a repeated down as the same hold', () => {
    const first = down(emptyTalkHolds(), 'desktop', 10);
    const again = down(first.state, 'desktop', 99_000);
    expect(again.mic).toBeNull();
    expect(again.state.holds).toEqual([{ source: 'desktop', channelId: null, since: 10 }]);
  });

  it('releases a source that disconnects and accepts a new hold after reconnect', () => {
    const phone = down(emptyTalkHolds(), 'phone', 5);
    const helper = down(phone.state, 'helper', 6);
    const dropped = reduceTalk(helper.state, { type: 'drop', source: 'phone', now: 7 });
    expect(dropped.mic).toBeNull();
    expect(dropped.state.holds.map((hold) => hold.source)).toEqual(['helper']);
    const gone = reduceTalk(dropped.state, { type: 'drop', source: 'helper', now: 8 });
    expect(gone.mic).toBe(false);
    const again = down(gone.state, 'phone', 9);
    expect(again.mic).toBe(true);
    expect(again.state.holds.map((hold) => hold.source)).toEqual(['phone']);
  });

  it('lets a tab blur release in-page keys and leave the phone and desktop key', () => {
    let state = emptyTalkHolds();
    for (const source of ['page', 'pointer', 'voice', 'phone', 'desktop'] as const) {
      state = down(state, source, 1).state;
    }
    const blurred = reduceTalk(state, { type: 'blur', now: 2 });
    expect(blurred.state.holds.map((hold) => hold.source)).toEqual(['phone', 'desktop']);
    expect(blurred.mic).toBeNull();
    const onlyPage = down(emptyTalkHolds(), 'page', 1);
    expect(reduceTalk(onlyPage.state, { type: 'blur', now: 2 }).mic).toBe(false);
  });

  it('releases a hold that has been down for 60 seconds and says so', () => {
    const fresh = down(emptyTalkHolds(), 'page', 1_000);
    const phone = down(fresh.state, 'phone', 1_000);
    const early = reduceTalk(phone.state, { type: 'tick', now: 1_000 + STUCK_TALK_MS - 1 });
    expect(early.mic).toBeNull();
    expect(early.state.holds).toHaveLength(2);
    expect(early.state.notice).toBeNull();
    const stuck = reduceTalk(phone.state, { type: 'tick', now: 1_000 + STUCK_TALK_MS });
    expect(stuck.mic).toBe(false);
    expect(stuck.state.holds).toEqual([]);
    expect(stuck.state.notice).toBe(STUCK_TALK_NOTICE);
    const kept = down(emptyTalkHolds(), 'helper', 50_000);
    const withOld = down(kept.state, 'phone', 0);
    const partial = reduceTalk(withOld.state, { type: 'tick', now: STUCK_TALK_MS });
    expect(partial.state.holds.map((hold) => hold.source)).toEqual(['helper']);
    expect(partial.mic).toBeNull();
    expect(partial.state.notice).toBe(STUCK_TALK_NOTICE);
  });

  it('moves the mic when a direct channel is the only named hold', () => {
    const page = down(emptyTalkHolds(), 'page', 1);
    const direct = down(page.state, 'direct', 2, 'alpha');
    expect(direct.mic).toBe(true);
    expect(direct.channelId).toBe('alpha');
    const released = up(direct.state, 'direct');
    expect(released.mic).toBe(true);
    expect(released.channelId).toBeNull();
    expect(down(emptyTalkHolds(), 'direct', 3, 'bravo').channelId).toBe('bravo');
  });

  it('clears the stuck notice on the next hold', () => {
    const stuck = reduceTalk(down(emptyTalkHolds(), 'phone', 0).state, { type: 'tick', now: STUCK_TALK_MS });
    expect(stuck.state.notice).toBe(STUCK_TALK_NOTICE);
    expect(down(stuck.state, 'phone', STUCK_TALK_MS + 10).state.notice).toBeNull();
    expect(reduceTalk(stuck.state, { type: 'dismiss', now: 1 }).state.notice).toBeNull();
  });
});
