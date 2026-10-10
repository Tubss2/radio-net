import { RECONNECTING, isNetworkFailure, isRouteMissing } from '../../../shared/net';

/** Thin client for the Radio Net API (see spike/server). */
export interface ChannelInfo { id: string; freq: string; freqKHz: number; name: string; restricted: boolean }
export interface CommunityInfo { id: string; name: string; inviteCode: string; band?: { minKHz: number; maxKHz: number; stepKHz: number } }
export interface Grant { channelId: string; room: string; freqKHz: number; name: string; canTransmit: boolean; token: string }
export interface JoinResult { token: string; expiresAt: string; callsign: string; community: CommunityInfo }
export interface CreateResult { adminKey: string; community: CommunityInfo }
export interface PhoneHostResult { livekitUrl: string; room: string; token: string; phoneIdentity: string }
export interface PhoneRedeemResult { livekitUrl: string; room: string; token: string; identity: string; callsign: string; communityId: string; communityName: string }

const bakedApi = import.meta.env.VITE_API_URL;
const apiFallback = import.meta.env.MODE === 'web' ? 'https://radio-149-28-170-200.sslip.io' : 'http://127.0.0.1:8787';
export const API_URL = bakedApi && bakedApi.length > 0 ? bakedApi : apiFallback;

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly routeMissing = false) {
    super(message);
    this.name = 'ApiError';
  }
}

export function isReconnectError(err: unknown): boolean {
  return err instanceof ApiError ? err.message === RECONNECTING : isNetworkFailure(err) || (err instanceof Error && err.message === RECONNECTING);
}

/** Waits before each attempt, including a zero before the first. Tests shorten this. */
const DEFAULT_RETRY_WAITS = [0, 400, 1200];

function note(line: string) {
  const log = (globalThis as { radionet?: { log?: (event: string, detail?: string) => void } }).radionet?.log;
  log?.('api', line);
}

export class Api {
  retryWaits = DEFAULT_RETRY_WAITS;
  constructor(public baseUrl: string, public token: string | null, public adminKey: string | null = null) {}
  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const method = init.method ?? 'GET';
    let lastStatus = 0;
    for (let attempt = 0; attempt < this.retryWaits.length; attempt++) {
      const wait = this.retryWaits[attempt] ?? 0;
      if (wait) await new Promise((r) => setTimeout(r, wait));
      try {
        const res = await fetch(this.baseUrl + path, {
          ...init,
          headers: {
            ...(init.body ? { 'content-type': 'application/json' } : {}),
            ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
            ...(this.adminKey ? { 'x-admin-key': this.adminKey } : {}),
          },
        });
        if (res.status === 204) return undefined as T;
        const body = await res.json().catch(() => ({} as { error?: string; message?: string }));
        if (!res.ok) {
          const routeMissing = isRouteMissing(res.status, body);
          const retryable = res.status === 502 || res.status === 503 || res.status === 504;
          if (retryable && attempt < this.retryWaits.length - 1) {
            lastStatus = res.status;
            note(`${method} ${path} ${res.status}`);
            continue;
          }
          note(`${method} ${path} ${res.status}`);
          const message = routeMissing ? 'This server cannot delete a community' : (body.error ?? `Request failed (${res.status})`);
          throw new ApiError(message, res.status, routeMissing);
        }
        return body as T;
      } catch (err) {
        if (err instanceof ApiError) throw err;
        if (!isNetworkFailure(err)) throw err;
        note(`${method} ${path} network`);
        if (attempt === this.retryWaits.length - 1) throw new ApiError(RECONNECTING, lastStatus);
      }
    }
    note(`${method} ${path} network`);
    throw new ApiError(RECONNECTING, lastStatus);
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
  deleteCommunity(cid: string) { return this.req<void>(`/api/communities/${cid}`, { method: 'DELETE' }); }
  tokens(cid: string, channelIds: string[]) {
    return this.req<{ livekitUrl: string; grants: Grant[] }>(`/api/communities/${cid}/radio/tokens`, { method: 'POST', body: JSON.stringify({ channelIds }) });
  }
  /** Admin broadcast. The server checks the session and the admin key before it forwards the mic. */
  allCall(cid: string, body: { active: boolean; sourceChannelId: string; channelIds: string[] }) {
    return this.req<{ ok: true }>(`/api/communities/${cid}/radio/all-call`, { method: 'POST', body: JSON.stringify(body) });
  }
  phoneHost(cid: string) {
    return this.req<PhoneHostResult>(`/api/communities/${cid}/radio/phone-host`, { method: 'POST' });
  }
  phonePair(cid: string) {
    return this.req<{ code: string; expiresAt: string }>(`/api/communities/${cid}/radio/phone-pair`, { method: 'POST' });
  }
  phoneRedeem(code: string) {
    return this.req<PhoneRedeemResult>('/api/phone/redeem', { method: 'POST', body: JSON.stringify({ code }) });
  }
}
