import type { Profile, ServerEntry } from './profile';

export interface BrowserSession {
  token: string;
  tokenExp?: number;
}

/** Callsign, server history, and settings. The join session is not part of this copy. */
export function profileForDisk(profile: Profile): Profile {
  return {
    ...profile,
    servers: profile.servers.map((server) => {
      const { token: _token, tokenExp: _exp, ...rest } = server;
      return rest;
    }),
  };
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
      if (!saved?.token) return { ...server, token: undefined, tokenExp: undefined };
      return { ...server, token: saved.token, tokenExp: saved.tokenExp };
    }),
  };
}
