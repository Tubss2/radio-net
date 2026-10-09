/** Shared between main, preload and renderer. */

/** A key or mouse button as seen by the global hook. */
export type Bind = { kind: 'key'; keycode: number; label: string } | { kind: 'mouse'; button: number; label: string };

export interface Keybinds {
  ptt: Bind | null; // talk on the active channel
  cycle: Bind | null; // move TX to the next tuned channel
  overlay: Bind | null; // show/hide overlay
  /** Direct push-to-talk on a specific tuned channel (channel id -> bind). */
  direct: Record<string, Bind>;
}

export type HotkeyEvent =
  | { type: 'ptt'; down: boolean }
  | { type: 'cycle' }
  | { type: 'overlay' }
  | { type: 'direct'; channelId: string; down: boolean };

export interface OverlayState {
  visible: boolean;
  txFreq: string | null;
  txName: string | null;
  transmitting: boolean;
  /** Who is talking right now, and on which channel. */
  speakers: { name: string; channel: string; freq: string }[];
}
