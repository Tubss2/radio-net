/** Main process appends this to userData/radio-net.log. Preview and tests have no bridge. */
export function clientLog(event: string, detail?: string): void {
  (globalThis as { radionet?: { log?: (event: string, detail?: string) => void } }).radionet?.log?.(event, detail);
}
