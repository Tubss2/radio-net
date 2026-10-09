import type { Profile, ServerEntry } from './profile';

export interface BrowserSession {
  token: string;
  tokenExp?: number;
}

/**
 * Callsign, server history, and settings.
 * The join session is never in this copy. The admin key is included only when the user opted in.
 */
export function profileForDisk(profile: Profile): Profile {
  return {
    ...profile,
    servers: profile.servers.map((server) => {
      const { token: _token, tokenExp: _exp, adminKey, rememberAdmin: _remember, ...rest } = server;
      if (server.rememberAdmin === true && typeof adminKey === 'string' && adminKey) {
        return { ...rest, adminKey, rememberAdmin: true as const };
      }
      return rest;
    }),
  };
}

/** A previous build stored the session token, or the admin key, in the durable blob. */
export function browserDiskNeedsScrub(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const servers = (raw as { servers?: unknown }).servers;
  if (!Array.isArray(servers)) return false;
  return servers.some((server) => {
    if (!server || typeof server !== 'object') return false;
    const row = server as { token?: unknown; adminKey?: unknown; rememberAdmin?: unknown };
    if (typeof row.token === 'string' && row.token) return true;
    return typeof row.adminKey === 'string' && Boolean(row.adminKey) && row.rememberAdmin !== true;
  });
}

export function sessionsFromProfile(profile: Profile): Record<string, BrowserSession> {
  const sessions: Record<string, BrowserSession> = {};
  for (const server of profile.servers) {
    if (!server.token) continue;
    sessions[server.id] = { token: server.token, tokenExp: server.tokenExp };
  }
  return sessions;
}

/** Put tab-scoped join sessions back onto the saved server list. A server with no session stays signed out. */
export function profileWithSessions(profile: Profile, sessions: Record<string, { token?: string; tokenExp?: number } | undefined>): Profile {
  return {
    ...profile,
    servers: profile.servers.map((server): ServerEntry => {
      const saved = sessions[server.id];
      const keepAdmin = server.rememberAdmin === true && typeof server.adminKey === 'string' && server.adminKey;
      const base: ServerEntry = keepAdmin ? { ...server } : { ...server, adminKey: undefined, rememberAdmin: undefined };
      if (!saved?.token) return { ...base, token: undefined, tokenExp: undefined };
      return { ...base, token: saved.token, tokenExp: saved.tokenExp };
    }),
  };
}
