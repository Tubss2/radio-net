/** Every way this radio can be asked to talk. The mic stays open while any of them is held. */
export const TALK_SOURCES = ['page', 'pointer', 'voice', 'phone', 'helper', 'desktop', 'direct'] as const;
export type TalkSource = (typeof TALK_SOURCES)[number];

/** In-page holds. Leaving the tab releases these and leaves phone, helper, and the desktop key. */
const PAGE_SOURCES: readonly TalkSource[] = ['page', 'pointer', 'voice'];

export const STUCK_TALK_MS = 60_000;
export const STUCK_TALK_NOTICE = 'Talk was released after 60 seconds. Hold the button again.';

export interface TalkHold {
  source: TalkSource;
  /** Set for a direct-channel key. Null follows the radio's current transmit channel. */
  channelId: string | null;
  since: number;
}

export interface TalkHoldState {
  holds: TalkHold[];
  notice: string | null;
}

export function emptyTalkHolds(): TalkHoldState {
  return { holds: [], notice: null };
}

export interface TalkInput {
  type: 'down' | 'up' | 'drop' | 'blur' | 'tick' | 'dismiss';
  source?: TalkSource;
  channelId?: string;
  now: number;
}

export interface TalkDecision {
  state: TalkHoldState;
  /** True opens or moves the mic. False closes it. Null leaves it alone. */
  mic: true | false | null;
  channelId: string | null;
}

export interface TalkHolds {
  down(source: TalkSource, channelId?: string): void;
  up(source: TalkSource): void;
  drop(source: TalkSource): void;
  blur(): void;
  notice: string | null;
  dismiss(): void;
}

/**
 * Open the mic, then read the hold set again. A release that arrives while unmute
 * is in flight leaves the set empty, so this closes the mic instead of staying on air.
 */
export async function openTalk(opts: {
  held: () => boolean;
  channelId?: string;
  unlock: () => Promise<void>;
  ptt: (down: boolean, channelId?: string) => Promise<boolean>;
}): Promise<void> {
  await opts.unlock();
  if (!opts.held()) return;
  await opts.ptt(true, opts.channelId);
  if (!opts.held()) await opts.ptt(false, opts.channelId);
}

export function talkChannel(state: TalkHoldState): string | null {
  for (let i = state.holds.length - 1; i >= 0; i--) {
    const id = state.holds[i].channelId;
    if (id) return id;
  }
  return null;
}

function decide(prev: TalkHoldState, next: TalkHoldState): TalkDecision {
  const was = prev.holds.length > 0;
  const now = next.holds.length > 0;
  const prevChannel = talkChannel(prev);
  const channelId = talkChannel(next);
  let mic: true | false | null = null;
  if (!was && now) mic = true;
  else if (was && !now) mic = false;
  else if (was && now && prevChannel !== channelId) mic = true;
  return { state: next, mic, channelId };
}

function without(state: TalkHoldState, sources: readonly TalkSource[]): TalkHoldState {
  return { ...state, holds: state.holds.filter((hold) => !sources.includes(hold.source)) };
}

/** One hold per source. Talk while the set is non-empty. An up with no matching down does nothing. */
export function reduceTalk(state: TalkHoldState, input: TalkInput): TalkDecision {
  if (input.type === 'dismiss') return decide(state, { ...state, notice: null });

  if (input.type === 'down') {
    const source = input.source;
    if (!source) return decide(state, state);
    if (state.holds.some((hold) => hold.source === source)) return decide(state, state);
    return decide(state, {
      notice: null,
      holds: [...state.holds, { source, channelId: input.channelId ?? null, since: input.now }],
    });
  }

  if (input.type === 'up' || input.type === 'drop') {
    const source = input.source;
    if (!source) return decide(state, state);
    return decide(state, without(state, [source]));
  }

  if (input.type === 'blur') return decide(state, without(state, PAGE_SOURCES));

  const stuck = state.holds.filter((hold) => input.now - hold.since >= STUCK_TALK_MS);
  if (stuck.length === 0) return decide(state, state);
  const dropped = new Set(stuck.map((hold) => hold.source));
  return decide(state, {
    notice: STUCK_TALK_NOTICE,
    holds: state.holds.filter((hold) => !dropped.has(hold.source)),
  });
}
