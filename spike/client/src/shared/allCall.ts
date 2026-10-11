/** Same attribute the API sets before it forwards the admin into other channel rooms. */
export const ALL_CALL_ATTR = 'rn.allcall';

export interface AllCallPeer {
  name: string;
  identity: string;
  attributes?: Record<string, string>;
  /** LiveKit forwarded the admin in from the channel they are actually transmitting on. */
  forwarded?: boolean;
  local?: boolean;
}

/** Display name of a remote all-call, if this room is carrying one. */
export function allCallSpeaker(participants: readonly AllCallPeer[]): string | null {
  for (const peer of participants) {
    if (peer.local) continue;
    const marked = peer.attributes?.[ALL_CALL_ATTR] === '1' || peer.forwarded === true;
    if (marked) return peer.name || peer.identity;
  }
  return null;
}
