/** How long the desktop waits for the next key while the main window is focused. */
export const BIND_RECORD_MS = 10_000;

/** Recording is armed only for the focused main window. The overlay and a background page cannot start it. */
export function canArmBindRecord(opts: { fromApp: boolean; isMainWindow: boolean; focused: boolean }): boolean {
  return opts.fromApp && opts.isMainWindow && opts.focused;
}
