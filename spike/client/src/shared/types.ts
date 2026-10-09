/** Shared between main, preload and renderer. */
import type { WheelInput, WheelSegmentView } from './radialWheel';

/** A key or mouse button as seen by the global hook. */
export type Bind = { kind: 'key'; keycode: number; label: string } | { kind: 'mouse'; button: number; label: string };

export interface Keybinds {
  ptt: Bind | null; // talk on the active channel
  cycle: Bind | null; // move TX to the next tuned channel (kept so the old smoke path still works)
  overlay: Bind | null; // show/hide overlay
  wheel: Bind | null; // open the channel radial (default F2)
  /** Direct push-to-talk on a specific tuned channel (channel id -> bind). */
  direct: Record<string, Bind>;
  /** Press to make that channel the transmit channel (channel id -> bind). */
  select: Record<string, Bind>;
}

export type HotkeyEvent =
  | { type: 'ptt'; down: boolean }
  | { type: 'cycle' }
  | { type: 'overlay' }
  | { type: 'direct'; channelId: string; down: boolean }
  | { type: 'select'; channelId: string }
  | { type: 'wheel'; down: boolean; heldMs: number }
  | { type: 'wheel-scroll'; steps: number; shift: boolean }
  | { type: 'wheel-number'; n: number }
  | { type: 'wheel-cancel' };

/** What the overlay draws for the channel wheel. The main window owns the model. */
export interface WheelView {
  open: boolean;
  segments: WheelSegmentView[];
  adding: boolean;
  addError: string;
}

export type { WheelInput };

export interface OverlayState {
  /** Talker rows. False hides them (F10, or nobody transmitting). The wheel can still be open. */
  visible: boolean;
  /** One row per person transmitting right now: display name and that channel. Empty draws nothing. */
  speakers: { name: string; channel: string; freq: string }[];
  wheel?: WheelView;
}
