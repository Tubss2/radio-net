/** Thin client for the Radio Net API (see spike/server). */
export interface ChannelInfo { id: string; freq: string; freqKHz: number; name: string; restricted: boolean }
export interface CommunityInfo { id: string; name: string; role: 'owner' | 'admin' | 'member'; inviteCode?: string }
export interface Grant { channelId: string; room: string; freqKHz: number; name: string; canTransmit: boolean; token: string }

export const API_URL = (import.meta as any).env?.VITE_API_URL ?? 'http://127.0.0.1:8787';

export class Api {
  constructor(public token: string | null) {}
  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(API_URL + path, {
      ...init,
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
    });
    if (res.status === 204) return undefined as T;
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
    return body as T;
  }
  me() { return this.req<{ account: { id: string; displayName: string }; communities: CommunityInfo[] }>('/api/me'); }
  join(inviteCode: string, displayName?: string) {
    return this.req<{ token?: string; community: CommunityInfo }>('/api/join', { method: 'POST', body: JSON.stringify({ inviteCode, displayName }) });
  }
  createCommunity(name: string, displayName?: string, setupCode?: string) {
    return this.req<{ token?: string; community: CommunityInfo }>('/api/communities', { method: 'POST', body: JSON.stringify({ name, displayName, setupCode }) });
  }
  channels(cid: string) { return this.req<{ channels: ChannelInfo[] }>(`/api/communities/${cid}/channels`).then((r) => r.channels); }
  createChannel(cid: string, freq: string, name: string) {
    return this.req<{ channel: ChannelInfo }>(`/api/communities/${cid}/channels`, { method: 'POST', body: JSON.stringify({ freq, name }) }).then((r) => r.channel);
  }
  deleteChannel(cid: string, chid: string) { return this.req<void>(`/api/communities/${cid}/channels/${chid}`, { method: 'DELETE' }); }
  tokens(cid: string, channelIds: string[]) {
    return this.req<{ livekitUrl: string; grants: Grant[] }>(`/api/communities/${cid}/radio/tokens`, { method: 'POST', body: JSON.stringify({ channelIds }) });
  }
}
