import { AccessToken, TrackSource } from 'livekit-server-sdk';
import { type Channel, roomNameFor } from './store.js';

export interface RadioUser {
  id: string; // session id for this visit; a new join gets a new identity
  displayName: string; // callsign, from the client
  tags: string[]; // BACKLOG: tags such as "SL", used by restricted channels
}

export interface ChannelGrant {
  channelId: string;
  room: string;
  freqKHz: number;
  name: string;
  canTransmit: boolean;
  token: string;
}

/** May this user hear a channel? MVP: everyone who joined (restrictedTag is always null for now). */
export function canListen(user: RadioUser, ch: Channel): boolean {
  return ch.restrictedTag === null || user.tags.includes(ch.restrictedTag);
}

/** May this user talk on a channel? MVP: same as listen. Kept separate so "listen-only" can be added later. */
export function canTransmit(user: RadioUser, ch: Channel): boolean {
  return canListen(user, ch);
}

/**
 * One LiveKit token per tuned channel.
 * - Everyone tuned gets canSubscribe.
 * - canPublish (microphone only) is granted on every tuned channel the user may talk on, so switching
 *   TX is instant (no reconnect). "Only one TX at a time" is enforced by the client; the server
 *   enforces *who may* talk where. No data/video/screen-share publishing.
 */
export async function mintChannelGrants(opts: {
  apiKey: string;
  apiSecret: string;
  user: RadioUser;
  channels: Channel[];
  ttlSeconds?: number;
}): Promise<ChannelGrant[]> {
  const { apiKey, apiSecret, user, channels, ttlSeconds = 600 } = opts;
  const out: ChannelGrant[] = [];
  for (const ch of channels) {
    if (!canListen(user, ch)) continue;
    const tx = canTransmit(user, ch);
    const at = new AccessToken(apiKey, apiSecret, {
      identity: user.id,
      name: user.displayName,
      ttl: ttlSeconds,
      metadata: JSON.stringify({ freqKHz: ch.freqKHz }),
    });
    const room = roomNameFor(ch);
    at.addGrant({
      room,
      roomJoin: true,
      canSubscribe: true,
      canPublish: tx,
      canPublishSources: tx ? [TrackSource.MICROPHONE] : [],
      canPublishData: false,
      canUpdateOwnMetadata: false,
    });
    out.push({ channelId: ch.id, room, freqKHz: ch.freqKHz, name: ch.name, canTransmit: tx, token: await at.toJwt() });
  }
  return out;
}
