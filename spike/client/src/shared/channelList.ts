/**
 * The channel list is polled, and a delete also updates it on the spot.
 * A response that started before the delete must not paint the channel back.
 */
export function acceptChannelList<T>(incomingGen: number, latestGen: number, incoming: T): T | null {
  return incomingGen === latestGen ? incoming : null;
}

/** Tuned channel ids the server list no longer contains. */
export function removedTunedIds(tunedIds: readonly string[], listedIds: Iterable<string>): string[] {
  const live = listedIds instanceof Set ? listedIds : new Set(listedIds);
  return tunedIds.filter((id) => !live.has(id));
}
