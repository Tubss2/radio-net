import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { DEFAULT_BAND, type Band, formatFrequency, parseFrequency, validateFrequency } from './freq.js';

/** A community ("net group"): created in the app, joined with an invite code. No user accounts. */
export interface Community {
  id: string;
  name: string;
  band: Band;
  inviteCode: string; // XXXX-XXXX, rotatable by whoever holds the admin key
  /** SHA-256 hex of the admin key. The plaintext key is only returned once, to the creator. */
  adminKeyHash: string;
  createdAt: string;
  /** Bumped when the invite rotates so existing session tokens stop working. Missing means 0. */
  sessionEpoch?: number;
}

export interface Channel {
  id: string; // stable id; LiveKit room is derived from this, not from freq/name
  communityId: string;
  freqKHz: number;
  name: string;
  /** BACKLOG: optional member tag (e.g. "SL") required to tune. null = anyone who joined. */
  restrictedTag: string | null;
  createdBy: string;
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

export interface StoreSnapshot {
  communities: Community[];
  channels: Channel[];
}

/**
 * Channel store. MemoryChannelStore is used by tests. FileChannelStore writes the same
 * data as JSON so a process restart keeps communities and channels.
 */
export interface ChannelStore {
  getCommunity(id: string): Community | undefined;
  communityByInvite(code: string): Community | undefined;
  listCommunities(): Community[];
  upsertCommunity(c: Community): void;
  list(communityId: string): Channel[];
  get(communityId: string, channelId: string): Channel | undefined;
  create(communityId: string, input: { freq: string | number; name: string }, userId: string): Channel;
  delete(communityId: string, channelId: string): Channel;
  deleteCommunity(id: string): Community;
  /** Resolve "59.5", "59.5 MHz", "command", "Comm" (unique prefix) to a channel. */
  resolve(communityId: string, query: string): Channel[];
}

export class MemoryChannelStore implements ChannelStore {
  private communities = new Map<string, Community>();
  private channels = new Map<string, Channel>(); // key = channel id

  /** Subclasses persist after a mutation. Loading must not call this. */
  protected persist() {}

  getCommunity(id: string) {
    return this.communities.get(id);
  }
  communityByInvite(code: string) {
    return [...this.communities.values()].find((c) => c.inviteCode === code);
  }
  listCommunities() {
    return [...this.communities.values()];
  }
  upsertCommunity(c: Community) {
    this.communities.set(c.id, c);
    this.persist();
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
    this.persist();
    return ch;
  }

  delete(communityId: string, channelId: string): Channel {
    const ch = this.get(communityId, channelId);
    if (!ch) throw new ChannelError('not_found', 'Channel not found');
    this.channels.delete(channelId);
    this.persist();
    return ch;
  }

  deleteCommunity(id: string): Community {
    const community = this.communities.get(id);
    if (!community) throw new ChannelError('not_found', 'Community not found');
    this.communities.delete(id);
    for (const [channelId, ch] of this.channels) {
      if (ch.communityId === id) this.channels.delete(channelId);
    }
    this.persist();
    return community;
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

  protected snapshot(): StoreSnapshot {
    return { communities: [...this.communities.values()], channels: [...this.channels.values()] };
  }

  /** Restore without writing. Used while a file store is loading. */
  protected restore(snap: StoreSnapshot) {
    this.communities.clear();
    this.channels.clear();
    for (const c of snap.communities) this.communities.set(c.id, c);
    for (const ch of snap.channels) this.channels.set(ch.id, ch);
  }
}

export function validateSnapshot(raw: unknown): StoreSnapshot {
  if (!raw || typeof raw !== 'object') throw new Error('store.json is not an object');
  const body = raw as { communities?: unknown; channels?: unknown };
  if (!Array.isArray(body.communities) || !Array.isArray(body.channels)) throw new Error('store.json is missing communities or channels');
  if (body.communities.length > 10_000 || body.channels.length > 100_000) throw new Error('store.json is too large');
  for (const c of body.communities) {
    if (!c || typeof c !== 'object') throw new Error('store.json has a bad community');
    const community = c as Partial<Community>;
    if (typeof community.id !== 'string' || typeof community.inviteCode !== 'string' || typeof community.adminKeyHash !== 'string') {
      throw new Error('store.json has a bad community');
    }
  }
  for (const ch of body.channels) {
    if (!ch || typeof ch !== 'object') throw new Error('store.json has a bad channel');
    const channel = ch as Partial<Channel>;
    if (typeof channel.id !== 'string' || typeof channel.communityId !== 'string' || typeof channel.freqKHz !== 'number') {
      throw new Error('store.json has a bad channel');
    }
  }
  return { communities: body.communities as Community[], channels: body.channels as Channel[] };
}

/** MAC over the communities and channels only, so a `mac` field is not part of itself. */
export function storeMac(snap: StoreSnapshot, key: string): string {
  return createHmac('sha256', key).update(JSON.stringify({ communities: snap.communities, channels: snap.channels })).digest('hex');
}

/** JSON file under a path such as /var/lib/radionet/store.json. Writes are atomic. Optional HMAC when macKey is set. */
export class FileChannelStore extends MemoryChannelStore {
  private ready = false;

  constructor(private file: string, private macKey?: string) {
    super();
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as { mac?: unknown };
      const snap = validateSnapshot(parsed);
      if (macKey && typeof parsed.mac === 'string' && !secretMacEqual(parsed.mac, storeMac(snap, macKey))) {
        throw new Error('store.json failed its integrity check');
      }
      this.restore(snap);
    }
    this.ready = true;
  }

  protected override persist() {
    if (!this.ready) return;
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o750 });
    const snap = this.snapshot();
    const body = this.macKey ? { ...snap, mac: storeMac(snap, this.macKey) } : snap;
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(body, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
    chmodSync(this.file, 0o600);
  }
}

function secretMacEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export { DEFAULT_BAND };
