import { bindId, UIO_ESCAPE } from './keybinds';
import { digitFromKeycode } from './radialWheel';
import type { Bind, Keybinds } from './types';

/**
 * Which input the global hook is allowed to act on.
 *
 * The Windows hook still delivers every key to the process. This function is the
 * line after which a key code may be stored or sent to the window. Anything that
 * returns false is dropped immediately.
 */
export interface WatchState {
  binds: Keybinds;
  /** The next key is being captured as a new bind. */
  recording: boolean;
  /** User has left keybinds on, and the first-run notice has been accepted. */
  enabled: boolean;
  wheelOpen: boolean;
  wheelKeyHeld: boolean;
}

export function shouldObserveInput(input: Bind, state: WatchState): boolean {
  if (!state.enabled && !state.recording) return false;
  if (state.recording) return true;
  if (matchesBound(input, state.binds)) return true;
  if (input.kind !== 'key') return false;
  if (!state.wheelOpen && !state.wheelKeyHeld) return false;
  if (input.keycode === UIO_ESCAPE) return true;
  if (state.wheelKeyHeld && digitFromKeycode(input.keycode) != null) return true;
  return false;
}

function matchesBound(input: Bind, binds: Keybinds): boolean {
  const id = bindId(input);
  const named = [binds.ptt, binds.cycle, binds.overlay, binds.wheel];
  if (named.some((b) => b && bindId(b) === id)) return true;
  for (const b of Object.values(binds.direct ?? {})) if (bindId(b) === id) return true;
  for (const b of Object.values(binds.select ?? {})) if (bindId(b) === id) return true;
  return false;
}
