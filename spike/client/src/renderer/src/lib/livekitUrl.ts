/** Prefer a URL baked in at build time (the Windows installer). Otherwise use the one the API returned. */
export function resolveLivekitUrl(fromApi: string, baked?: string): string {
  return baked && baked.length > 0 ? baked : fromApi;
}
