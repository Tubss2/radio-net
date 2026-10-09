import { describe, expect, it, vi } from 'vitest';
import { RECONNECTING } from '../../../shared/net';
import { Api, ApiError } from './api';

describe('API client', () => {
  it('retries a dropped fetch and then says Reconnecting', async () => {
    const notes: string[] = [];
    (globalThis as { radionet?: { log?: (event: string, detail?: string) => void } }).radionet = {
      log: (_event, detail) => { if (detail) notes.push(detail); },
    };
    const fetchMock = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    vi.stubGlobal('fetch', fetchMock);
    const api = new Api('https://radio.example', 'session-token-value', 'rnk_livekey');
    api.retryWaits = [0, 0, 0];
    await expect(api.channels('wdnz')).rejects.toMatchObject({ message: RECONNECTING, name: 'ApiError' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(notes.join('\n')).toContain('GET /api/communities/wdnz/channels network');
    expect(notes.join('\n')).not.toContain('session-token-value');
    expect(notes.join('\n')).not.toContain('rnk_livekey');
    vi.unstubAllGlobals();
    delete (globalThis as { radionet?: unknown }).radionet;
  });

  it('treats a missing route as unsupported and keeps a real 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).endsWith('/rn-route-probe')) {
        return new Response(JSON.stringify({ message: 'Route DELETE:/api/communities/rn-route-probe not found', error: 'Not Found', statusCode: 404 }), { status: 404 });
      }
      return new Response(JSON.stringify({ error: 'Community not found' }), { status: 404 });
    }));
    const api = new Api('https://radio.example', null, 'rnk_livekey');
    api.retryWaits = [0];
    const missing = await api.deleteCommunity('rn-route-probe').then(() => null, (e) => e as ApiError);
    const gone = await api.deleteCommunity('real').then(() => null, (e) => e as ApiError);
    expect(missing).toMatchObject({ routeMissing: true, status: 404 });
    expect(gone).toMatchObject({ routeMissing: false, status: 404, message: 'Community not found' });
    vi.unstubAllGlobals();
  });
});
