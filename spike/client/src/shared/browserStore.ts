import { normaliseProfile, type Profile, type ServerEntry } from './profile';

/** Durable radio settings. Must not contain a session token or an admin key. */
export const PROFILE_KEY = 'rn.profile';
/** Opt-in admin keys, still localStorage, still readable by any script on this origin. */
export const ADMIN_KEY = 'rn.admin';
/** Session tokens. sessionStorage dies with the tab. */
export const SESSION_KEY = 'rn.session';

export interface BrowserStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface StoredSession {
  token: string;
  tokenExp?: number;
}

function parseObject(raw: string | null): Record<string, unknown> {
  try {
    const value = JSON.parse(raw || 'null') as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readSessions(raw: string | null): Record<string, StoredSession> {
  const out: Record<string, StoredSession> = {};
  for (const [id, value] of Object.entries(parseObject(raw))) {
    if (!value || typeof value !== 'object') continue;
    const row = value as { token?: unknown; tokenExp?: unknown };
    if (typeof row.token !== 'string' || !row.token) continue;
    out[id] = { token: row.token, ...(typeof row.tokenExp === 'number' ? { tokenExp: row.tokenExp } : {}) };
  }
  return out;
}

function readAdmins(raw: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, value] of Object.entries(parseObject(raw))) {
    if (typeof value === 'string' && value) out[id] = value;
  }
  return out;
}

function durableServer(server: ServerEntry, remember: boolean): ServerEntry {
  const next: ServerEntry = { ...server };
  delete next.token;
  delete next.tokenExp;
  delete next.adminKey;
  if (remember) next.rememberAdmin = true;
  else delete next.rememberAdmin;
  return next;
}

/** Write the profile. Tokens go to session storage. Admin keys go to local storage only when rememberAdmin is set. */
export function saveBrowserProfile(profile: Profile, local: BrowserStorage, session: BrowserStorage): void {
  const sessions: Record<string, StoredSession> = {};
  const admins: Record<string, string> = {};
  const servers = profile.servers.map((server) => {
    const remember = server.rememberAdmin === true;
    if (typeof server.token === 'string' && server.token) {
      sessions[server.id] = {
        token: server.token,
        ...(typeof server.tokenExp === 'number' ? { tokenExp: server.tokenExp } : {}),
      };
    }
    if (remember && typeof server.adminKey === 'string' && server.adminKey) admins[server.id] = server.adminKey;
    return durableServer(server, remember);
  });
  local.setItem(PROFILE_KEY, JSON.stringify({ ...profile, servers }));
  if (Object.keys(sessions).length) session.setItem(SESSION_KEY, JSON.stringify(sessions));
  else session.removeItem(SESSION_KEY);
  if (Object.keys(admins).length) local.setItem(ADMIN_KEY, JSON.stringify(admins));
  else local.removeItem(ADMIN_KEY);
}

/**
 * Read the profile back. A blob left over from the old "everything in localStorage" path
 * is rewritten on the way in: the token moves to session storage, and the admin key is
 * kept for this page only unless rememberAdmin was already set.
 */
export function loadBrowserProfile(local: BrowserStorage, session: BrowserStorage): Profile {
  const profile = normaliseProfile(parseObject(local.getItem(PROFILE_KEY)));
  const storedSessions = readSessions(session.getItem(SESSION_KEY));
  const storedAdmins = readAdmins(local.getItem(ADMIN_KEY));
  let legacySecrets = false;
  const servers = profile.servers.map((server) => {
    const remember = server.rememberAdmin === true;
    const legacyToken = typeof server.token === 'string' && server.token ? server.token : undefined;
    const legacyAdmin = typeof server.adminKey === 'string' && server.adminKey ? server.adminKey : undefined;
    if (legacyToken || legacyAdmin) legacySecrets = true;
    const sess = storedSessions[server.id] ?? (legacyToken
      ? { token: legacyToken, ...(typeof server.tokenExp === 'number' ? { tokenExp: server.tokenExp } : {}) }
      : undefined);
    const admin = remember ? (storedAdmins[server.id] ?? legacyAdmin) : legacyAdmin;
    const next: ServerEntry = durableServer(server, remember);
    if (sess) {
      next.token = sess.token;
      if (typeof sess.tokenExp === 'number') next.tokenExp = sess.tokenExp;
    }
    if (admin) next.adminKey = admin;
    return next;
  });
  const merged: Profile = { ...profile, servers };
  if (legacySecrets) saveBrowserProfile(merged, local, session);
  return merged;
}
