import { RECONNECTING, isNetworkFailure, isRouteMissing } from '../../../shared/net';

/** Thin client for the Radio Net API (see spike/server). */
export interface ChannelInfo { id: string; freq: string; freqKHz: number; name: string; restricted: boolean }
export interface CommunityInfo { id: string; name: string; inviteCode?: string; band?: { minKHz: number; maxKHz: number; stepKHz: number } }
export interface Grant { channelId: string; room: string; freqKHz: number; name: string; canTransmit: boolean; token: string }
export interface JoinResult {
  token: string;
  expiresAt: string;
  callsign: string;
  community: CommunityInfo;
  role?: 'member' | 'admin';
  deviceId?: string;
}
export interface DeviceRow {
  deviceId: string;
  shortId: string;
  callsign: string;
  role: 'member' | 'admin';
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
  inviteId: string;
  inviteLabel: string | null;
}
export interface InviteRow {
  id: string;
  code: string;
  label: string | null;
  createdAt: string;
  createdBy: string;
  maxUses: number | null;
  uses: number;
  expiresAt: string | null;
  revokedAt: string | null;
}
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
  register(body: { inviteCode: string; callsign: string; deviceId: string; publicKeySpki: string }) {
    return this.req<JoinResult>('/api/join/register', { method: 'POST', body: JSON.stringify(body) });
  }
  migrate(body: { deviceId: string; publicKeySpki: string; callsign: string }) {
    return this.req<JoinResult>('/api/join/migrate', { method: 'POST', body: JSON.stringify(body) });
  }
  challenge(cid: string, deviceId: string) {
    return this.req<{ challengeId: string; nonce: string; expiresAt: string }>(`/api/communities/${cid}/challenge`, {
      method: 'POST', body: JSON.stringify({ deviceId }),
    });
  }
  joinSigned(cid: string, body: { challengeId: string; deviceId: string; signature: string; callsign: string }) {
    return this.req<JoinResult>(`/api/communities/${cid}/join`, { method: 'POST', body: JSON.stringify(body) });
  }
  devices(cid: string) {
    return this.req<{ devices: DeviceRow[] }>(`/api/communities/${cid}/devices`).then((r) => r.devices);
  }
  revokeDevice(cid: string, deviceId: string) {
    return this.req<{ deviceId: string; revokedAt: string | null }>(`/api/communities/${cid}/devices/${deviceId}/revoke`, { method: 'POST' });
  }
  restoreDevice(cid: string, deviceId: string) {
    return this.req<{ deviceId: string; revokedAt: string | null }>(`/api/communities/${cid}/devices/${deviceId}/restore`, { method: 'POST' });
  }
  setDeviceRole(cid: string, deviceId: string, role: 'admin' | 'member') {
    return this.req<{ deviceId: string; role: 'admin' | 'member' }>(`/api/communities/${cid}/devices/${deviceId}/role`, {
      method: 'POST', body: JSON.stringify({ role }),
    });
  }
  claimAdmin(cid: string) {
    return this.req<{ role: 'admin'; deviceId: string }>(`/api/communities/${cid}/claim-admin`, { method: 'POST', body: '{}' });
  }
  invites(cid: string) {
    return this.req<{ invites: InviteRow[] }>(`/api/communities/${cid}/invites`).then((r) => r.invites);
  }
  createInvite(cid: string, body: { label?: string; maxUses?: number | null; expiresAt?: string | null }) {
    return this.req<{ invite: InviteRow }>(`/api/communities/${cid}/invites`, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.invite);
  }
  revokeInvite(cid: string, inviteId: string) {
    return this.req<{ invite: InviteRow }>(`/api/communities/${cid}/invites/${inviteId}/revoke`, { method: 'POST' }).then((r) => r.invite);
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
