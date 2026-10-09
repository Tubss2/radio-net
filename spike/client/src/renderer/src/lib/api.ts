/** Thin client for the Radio Net API (see spike/server). */
export interface ChannelInfo { id: string; freq: string; freqKHz: number; name: string; restricted: boolean }
export interface CommunityInfo { id: string; name: string; inviteCode: string; band?: { minKHz: number; maxKHz: number; stepKHz: number } }
export interface Grant { channelId: string; room: string; freqKHz: number; name: string; canTransmit: boolean; token: string }
export interface JoinResult { token: string; expiresAt: string; callsign: string; community: CommunityInfo }
export interface CreateResult { adminKey: string; community: CommunityInfo }

const bakedApi = import.meta.env.VITE_API_URL;
export const API_URL = bakedApi && bakedApi.length > 0 ? bakedApi : 'http://127.0.0.1:8787';

export class Api {
  constructor(public baseUrl: string, public token: string | null, public adminKey: string | null = null) {}
  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(this.baseUrl + path, {
      ...init,
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        ...(this.adminKey ? { 'x-admin-key': this.adminKey } : {}),
      },
    });
    if (res.status === 204) return undefined as T;
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
    return body as T;
  }
  join(inviteCode: string, callsign: string) {
    return this.req<JoinResult>('/api/join', { method: 'POST', body: JSON.stringify({ inviteCode, callsign }) });
  }
  createCommunity(name: string, setupCode?: string) {
    return this.req<CreateResult>('/api/communities', { method: 'POST', body: JSON.stringify({ name, setupCode }) });
  }
  rotateInvite(cid: string) {
    return this.req<{ inviteCode: string }>(`/api/communities/${cid}/invite/rotate`, { method: 'POST' });
  }
  rotateAdminKey(cid: string, setupCode: string) {
    return this.req<{ adminKey: string }>(`/api/communities/${cid}/admin/rotate`, { method: 'POST', body: JSON.stringify({ setupCode }) });
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
