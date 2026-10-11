import { roomAlreadyGone } from './rooms.js';
import { roomNameFor, type Channel } from './store.js';

/** Participant attribute LiveKit copies onto a forwarded all-call. Empty string clears it. */
export const ALL_CALL_ATTR = 'rn.allcall';

export interface AllCallPlan {
  sourceRoom: string;
  /** Other tuned channel rooms. The source room is not included. */
  destinations: string[];
}

/**
 * Rooms to mark and forward. Channel ids come from the client, but room names
 * are derived only from channels this community actually has.
 */
export function planAllCall(
  sourceChannelId: string,
  channelIds: readonly string[],
  channels: readonly Channel[],
): AllCallPlan | 'empty' | 'too_many' | 'unknown' | 'source' {
  if (channelIds.length === 0) return 'empty';
  if (channelIds.length > 16) return 'too_many';
  const unique = [...new Set(channelIds)];
  if (!unique.includes(sourceChannelId)) return 'source';
  const byId = new Map(channels.map((ch) => [ch.id, ch]));
  const picked: Channel[] = [];
  for (const id of unique) {
    const ch = byId.get(id);
    if (!ch) return 'unknown';
    picked.push(ch);
  }
  const source = byId.get(sourceChannelId);
  if (!source) return 'unknown';
  const sourceRoom = roomNameFor(source);
  return {
    sourceRoom,
    destinations: picked.map(roomNameFor).filter((room) => room !== sourceRoom),
  };
}

/** LiveKit room admin for all-call. Tests pass a fake. Production wraps RoomService. */
export interface AllCallControl {
  /** Set or clear the all-call attribute on the admin in the source room. */
  mark(room: string, identity: string, on: boolean): Promise<void>;
  /** Carry that participant into another channel room. */
  forward(from: string, identity: string, to: string): Promise<void>;
  /** Remove the forwarded participant from a destination room. Never the source room. */
  stop(room: string, identity: string): Promise<void>;
}

/** The admin is not in the source room, or that room is already gone. */
export function allCallUnavailable(err: unknown): boolean {
  if (roomAlreadyGone(err)) return true;
  if (!err || typeof err !== 'object') return false;
  const message = typeof (err as { message?: unknown }).message === 'string'
    ? (err as { message: string }).message.toLowerCase()
    : '';
  return message.includes('not found') && (message.includes('participant') || message.includes('room'));
}

/** Room names passed here are already limited to this community's channels. */
export function liveKitAllCall(client: {
  updateParticipant(room: string, identity: string, options: { attributes: Record<string, string> }): Promise<unknown>;
  createRoom(options: { name: string; emptyTimeout?: number; departureTimeout?: number }): Promise<unknown>;
  forwardParticipant(room: string, identity: string, destinationRoom: string): Promise<unknown>;
  removeParticipant(room: string, identity: string): Promise<unknown>;
}): AllCallControl {
  return {
    mark(room, identity, on) {
      return client.updateParticipant(room, identity, { attributes: { [ALL_CALL_ATTR]: on ? '1' : '' } }).then(() => undefined);
    },
    async forward(from, identity, to) {
      await client.createRoom({ name: to, emptyTimeout: 5 * 60, departureTimeout: 20 });
      await client.forwardParticipant(from, identity, to);
    },
    async stop(room, identity) {
      try {
        await client.removeParticipant(room, identity);
      } catch (err) {
        if (!allCallUnavailable(err)) throw err;
      }
    },
  };
}
