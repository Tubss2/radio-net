import { createHash, randomBytes, randomUUID } from 'node:crypto';

/**
 * Lightweight accounts, no Discord, no email, no passwords.
 *
 * - An Account is created the first time someone joins or creates a community. The server returns a
 *   long random device token ONCE; the client keeps it in Windows' encrypted storage (Electron safeStorage).
 *   The server stores only a SHA-256 hash of it.
 * - Communities ("net groups") are joined with an invite code + display name.
 * - Roles: owner > admin > member. Owner/admins create & delete channels, rotate the invite, kick, promote.
 * - Lost device? An admin issues a one-time recovery code for that member (backlog: self-serve recovery).
 */
export type Role = 'owner' | 'admin' | 'member';

export interface Account {
  id: string;
  displayName: string;
  tokenHash: string;
  createdAt: string;
}

export interface Membership {
  communityId: string;
  accountId: string;
  role: Role;
  joinedAt: string;
}

export const DISPLAY_NAME_MAX = 32;

/** Invite codes: 8 chars from an unambiguous alphabet, shown as XXXX-XXXX. ~40 bits; joins are rate-limited. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function newInviteCode(): string {
  const b = randomBytes(8);
  const s = [...b].map((x) => ALPHABET[x % ALPHABET.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}
export function normaliseInvite(code: string): string {
  const s = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4)}` : s;
}

export function newDeviceToken(): string {
  return `rn_${randomBytes(32).toString('base64url')}`;
}
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function cleanDisplayName(name: string): string | null {
  const n = (name ?? '').trim().replace(/\s+/g, ' ');
  if (!n || n.length > DISPLAY_NAME_MAX) return null;
  return n;
}

export class MemoryAccountStore {
  private accounts = new Map<string, Account>();
  private byTokenHash = new Map<string, string>();
  private memberships: Membership[] = [];

  createAccount(displayName: string): { account: Account; token: string } {
    const token = newDeviceToken();
    const account: Account = { id: randomUUID().slice(0, 12), displayName, tokenHash: hashToken(token), createdAt: new Date().toISOString() };
    this.accounts.set(account.id, account);
    this.byTokenHash.set(account.tokenHash, account.id);
    return { account, token };
  }
  byToken(token: string): Account | undefined {
    const id = this.byTokenHash.get(hashToken(token));
    return id ? this.accounts.get(id) : undefined;
  }
  get(id: string) {
    return this.accounts.get(id);
  }
  membership(communityId: string, accountId: string) {
    return this.memberships.find((m) => m.communityId === communityId && m.accountId === accountId);
  }
  membershipsOf(accountId: string) {
    return this.memberships.filter((m) => m.accountId === accountId);
  }
  members(communityId: string) {
    return this.memberships.filter((m) => m.communityId === communityId);
  }
  addMembership(communityId: string, accountId: string, role: Role) {
    const existing = this.membership(communityId, accountId);
    if (existing) return existing;
    const m: Membership = { communityId, accountId, role, joinedAt: new Date().toISOString() };
    this.memberships.push(m);
    return m;
  }
  removeMembership(communityId: string, accountId: string) {
    this.memberships = this.memberships.filter((m) => !(m.communityId === communityId && m.accountId === accountId));
  }
}
