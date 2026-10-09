/**
 * A browser hold can miss keyup: the tab was hidden, or the window lost focus.
 * Those end push-to-talk. Pointer release belongs on a hold button, not on every click,
 * so adjusting the volume while Space is held does not drop the transmission.
 */
export function shouldDropBrowserPtt(input: { type: string; visibilityState?: string; code?: string }): boolean {
  if (input.type === 'blur') return true;
  if (input.type === 'visibilitychange') return input.visibilityState === 'hidden';
  if (input.type === 'keyup') return input.code === 'Space';
  return false;
}

/** A future on-screen hold button releases on these pointer events. A click elsewhere does not. */
export function isHoldButtonRelease(type: string): boolean {
  return type === 'pointerup' || type === 'pointercancel' || type === 'pointerleave';
}
