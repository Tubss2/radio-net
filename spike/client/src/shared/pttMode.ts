/** Helper window default talk key. The page does not hear a later rebind. */
export const HELPER_TALK_KEY = 'F1';

export interface PttModeView {
  /** Shown on the main radio, for example `PTT: Browser (Space)`. */
  label: string;
  /** Short name of the active option, used on the setup button. */
  option: string;
  /** Which live link Disconnect ends. Browser and voice have no remote link. */
  disconnect: 'phone' | 'helper' | null;
  live: boolean;
}

/**
 * One active mode. A linked phone wins, then a connected helper, then voice, then the in-page key.
 * Browser and voice stay available underneath; this is the line the radio shows.
 */
export function pttModeView(input: {
  talkMode: 'hold' | 'voice';
  talkLabel: string;
  phoneLinked: boolean;
  helperLinked: boolean;
}): PttModeView {
  if (input.phoneLinked) {
    return { label: 'PTT: Phone linked', option: 'Phone linked', disconnect: 'phone', live: true };
  }
  if (input.helperLinked) {
    return { label: `PTT: Helper connected (${HELPER_TALK_KEY})`, option: 'Helper connected', disconnect: 'helper', live: true };
  }
  if (input.talkMode === 'voice') {
    return { label: 'PTT: Voice activation', option: 'Voice activation', disconnect: null, live: true };
  }
  const key = input.talkLabel || 'Space';
  return { label: `PTT: Browser (${key})`, option: `Browser (${key})`, disconnect: null, live: true };
}

/** One line for the web radio after someone picks how they talk. */
export function describePttMode(input: {
  talkMode: 'hold' | 'voice';
  talkLabel: string;
  phoneLinked: boolean;
  helperLinked: boolean;
}): string {
  return pttModeView(input).label;
}
