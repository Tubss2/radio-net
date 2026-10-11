/** Shared between main, preload and renderer. */
import type { WheelInput, WheelSegmentView } from './radialWheel';

/** A key or mouse button as seen by the global hook. */
export type Bind = { kind: 'key'; keycode: number; label: string } | { kind: 'mouse'; button: number; label: string };

export interface Keybinds {
  ptt: Bind | null; // talk on the active channel (desktop default F1, hold)
  prev: Bind | null; // previous transmit channel (desktop default F3)
  next: Bind | null; // next transmit channel (desktop default F4)
  overlay: Bind | null; // show/hide overlay (desktop default F5)
  wheel: Bind | null; // open the channel radial (desktop default F2)
  /** Direct push-to-talk on a specific tuned channel (channel id -> bind). */
  direct: Record<string, Bind>;
  /** Press to make that channel the transmit channel (channel id -> bind). */
  select: Record<string, Bind>;
}

export type HotkeyEvent =
  | { type: 'ptt'; down: boolean }
  | { type: 'cycle'; step?: 1 | -1 }
  | { type: 'overlay' }
  | { type: 'direct'; channelId: string; down: boolean }
  | { type: 'select'; channelId: string }
  | { type: 'wheel'; down: boolean; heldMs: number }
  | { type: 'wheel-scroll'; steps: number; shift: boolean }
  | { type: 'wheel-number'; n: number }
  | { type: 'wheel-cancel' };

/** What the overlay draws for the channel wheel. The main window owns the model. */
export interface WheelChannelChoice {
  id: string;
  freq: string;
  name: string;
}

/** A downloaded Windows update waiting for the user to restart. */
export interface UpdateReady { version: string }

export interface WheelView {
  open: boolean;
  segments: WheelSegmentView[];
  adding: boolean;
  addError: string;
  /** Community channels not already tuned, shown when the + slice is open. */
  available: WheelChannelChoice[];
  /** Admins can type a frequency to create a channel from that list. */
  canCreate: boolean;
}

export type { WheelInput };

export interface OverlayState {
  /** Talker rows. False hides them (the overlay bind, or nobody transmitting). The wheel can still be open. */
  visible: boolean;
  /** One row per person transmitting, or who just stopped and is fading out. Empty draws nothing. */
  speakers: { name: string; channel: string; freq: string; opacity?: number }[];
  wheel?: WheelView;
}
