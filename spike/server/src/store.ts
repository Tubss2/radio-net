import { randomUUID } from 'node:crypto';
import { DEFAULT_BAND, type Band, formatFrequency, parseFrequency, validateFrequency } from './freq.js';

/** A community ("net group"): created in the app, joined with an invite code. No Discord needed. */
export interface Community {
  id: string;
  name: string;
  band: Band;
  inviteCode: string; // XXXX-XXXX, rotatable by admins
  createdAt: string;
}

export interface Channel {
  id: string; // stable id; LiveKit room is derived from this, not from freq/name
  communityId: string;
  freqKHz: number;
  name: string;
  /** BACKLOG: optional member tag (e.g. "SL") required to tune. null = anyone in the community. */
  restrictedTag: string | null;
  createdBy: string; // account id
  createdAt: string;
}

export class ChannelError extends Error {
  constructor(
    public code: 'invalid' | 'conflict' | 'not_found',
    message: string,
  ) {
    super(message);
  }
}

export const NAME_MAX = 24;

export function normaliseName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

/** LiveKit room name for a channel. Keyed on channel id so deleting + recreating a freq gives a fresh room. */
export function roomNameFor(ch: Pick<Channel, 'communityId' | 'id'>): string {
  return `g${ch.communityId}.ch${ch.id}`;
}

/**
 * Spike store: in memory. Interface is what the real (SQLite) store must implement.
 */
export interface ChannelStore {
  getCommunity(id: string): Community | undefined;
  communityByInvite(code: string): Community | undefined;
  upsertCommunity(c: Community): void;
  list(communityId: string): Channel[];
  get(communityId: string, channelId: string): Channel | undefined;
  create(communityId: string, input: { freq: string | number; name: string }, userId: string): Channel;
  delete(communityId: string, channelId: string): Channel;
  /** Resolve "59.5", "59.5 MHz", "command", "Comm" (unique prefix) to a channel. */
  resolve(communityId: string, query: string): Channel[];
}

export class MemoryChannelStore implements ChannelStore {
  private communities = new Map<string, Community>();
  private channels = new Map<string, Channel>(); // key = channel id

  getCommunity(id: string) {
    return this.communities.get(id);
  }
  communityByInvite(code: string) {
    return [...this.communities.values()].find((c) => c.inviteCode === code);
  }
  upsertCommunity(c: Community) {
    this.communities.set(c.id, c);
  }

  list(communityId: string) {
    return [...this.channels.values()]
      .filter((c) => c.communityId === communityId)
      .sort((a, b) => a.freqKHz - b.freqKHz);
  }

  get(communityId: string, channelId: string) {
    const c = this.channels.get(channelId);
    return c && c.communityId === communityId ? c : undefined;
  }

  create(communityId: string, input: { freq: string | number; name: string }, userId: string): Channel {
    const community = this.communities.get(communityId);
    if (!community) throw new ChannelError('not_found', 'Unknown community');
    const freqKHz = parseFrequency(input.freq);
    if (freqKHz === null) throw new ChannelError('invalid', 'Frequency looks wrong, e.g. 59.5');
    const freqErr = validateFrequency(freqKHz, community.band);
    if (freqErr) throw new ChannelError('invalid', freqErr);
    const name = normaliseName(input.name ?? '');
    if (!name) throw new ChannelError('invalid', 'Channel needs a name');
    if (name.length > NAME_MAX) throw new ChannelError('invalid', `Name must be ${NAME_MAX} characters or fewer`);
    const existing = this.list(communityId);
    if (existing.some((c) => c.freqKHz === freqKHz))
      throw new ChannelError('conflict', `${formatFrequency(freqKHz)} MHz is already in use`);
    if (existing.some((c) => c.name.toLowerCase() === name.toLowerCase()))
      throw new ChannelError('conflict', `A channel called "${name}" already exists`);
    const ch: Channel = {
      id: randomUUID().slice(0, 8),
      communityId,
      freqKHz,
      name,
      restrictedTag: null,
      createdBy: userId,
      createdAt: new Date().toISOString(),
    };
    this.channels.set(ch.id, ch);
    return ch;
  }

  delete(communityId: string, channelId: string): Channel {
    const ch = this.get(communityId, channelId);
    if (!ch) throw new ChannelError('not_found', 'Channel not found');
    this.channels.delete(channelId);
    return ch;
  }

  resolve(communityId: string, query: string): Channel[] {
    const all = this.list(communityId);
    const q = query.trim();
    const kHz = parseFrequency(q);
    if (kHz !== null) {
      const hit = all.find((c) => c.freqKHz === kHz);
      if (hit) return [hit];
    }
    const lower = q.toLowerCase();
    const exact = all.filter((c) => c.name.toLowerCase() === lower);
    if (exact.length) return exact;
    return all.filter((c) => c.name.toLowerCase().startsWith(lower));
  }
}

export { DEFAULT_BAND };
