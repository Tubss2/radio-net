/** LiveKit rooms this process is allowed to close. Tests pass a fake. */
export interface RoomAdmin {
  listRooms(): Promise<Array<{ name?: string }>>;
  deleteRoom(name: string): Promise<unknown>;
}

/** Channel rooms we know about, plus phone rooms LiveKit still has for this community. */
export function roomsToClose(cid: string, listed: readonly { name?: string }[], channelRooms: readonly string[]): string[] {
  const names = new Set<string>(channelRooms);
  const phone = `g${cid}.phone.`;
  for (const room of listed) {
    const name = room.name ?? '';
    if (name.startsWith(phone)) names.add(name);
  }
  return [...names];
}

/** A missing room is already empty. Anything else means people may still be in it. */
export function roomAlreadyGone(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { status?: number; code?: string };
  return e.status === 404 || e.code === 'not_found';
}

export async function dropCommunityRooms(admin: RoomAdmin, cid: string, channelRooms: readonly string[]): Promise<void> {
  const listed = await admin.listRooms();
  for (const name of roomsToClose(cid, listed, channelRooms)) {
    try {
      await admin.deleteRoom(name);
    } catch (err) {
      if (!roomAlreadyGone(err)) throw err;
    }
  }
}
