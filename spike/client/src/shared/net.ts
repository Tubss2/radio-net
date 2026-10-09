/** Shown while a blip is retrying. The raw browser message stays in the log. */
export const RECONNECTING = 'Reconnecting…';

export function isNetworkFailure(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /failed to fetch|networkerror|network request failed|load failed|econnreset|econnrefused/i.test(msg);
}

/** Fastify's own 404 names the missing route. Our handlers say the community was not found. */
export function isRouteMissing(status: number, body: { message?: unknown }): boolean {
  return status === 404 && typeof body.message === 'string' && body.message.startsWith('Route ');
}
