import { formatFreqKHz, parseFreqInput, validateFrequency } from '../../../shared/freq';
import { Api, type ChannelInfo, type CommunityInfo, type CreateResult, type JoinResult } from './api';

export const PREVIEW_COMMUNITY_ID = 'wdnz';

export const PREVIEW_CHANNELS: ChannelInfo[] = [
  { id: 'arty', freqKHz: 41500, freq: '41.5', name: 'Arty', restricted: false },
  { id: 'logi', freqKHz: 45000, freq: '45.0', name: 'Logi', restricted: false },
  { id: 'cmd', freqKHz: 59500, freq: '59.5', name: 'Command', restricted: false },
  { id: 'alpha', freqKHz: 62000, freq: '62.0', name: 'Alpha FT', restricted: false },
  { id: 'bravo', freqKHz: 62500, freq: '62.5', name: 'Bravo FT', restricted: false },
];

const community = (): CommunityInfo => ({
  id: PREVIEW_COMMUNITY_ID,
  name: 'War Dogs NZ',
  inviteCode: 'K7QM-2XPA',
});

/** Fake server: one community and a handful of channels. No network. */
export class PreviewApi extends Api {
  constructor() {
    super('preview', 'preview', 'rnk_preview');
  }

  channelsList: ChannelInfo[] = PREVIEW_CHANNELS.map((c) => ({ ...c }));

  join(_inviteCode: string, callsign: string): Promise<JoinResult> {
    return Promise.resolve({
      token: 'preview',
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      callsign,
      community: community(),
    });
  }

  createCommunity(name: string): Promise<CreateResult> {
    return Promise.resolve({ adminKey: 'rnk_preview', community: { ...community(), name: name || community().name } });
  }

  rotateInvite() {
    return Promise.resolve({ inviteCode: 'K7QM-2XPA' });
  }

  rotateAdminKey() {
    return Promise.resolve({ adminKey: 'rnk_preview' });
  }

  channels() {
    return Promise.resolve(this.channelsList.map((c) => ({ ...c })));
  }

  createChannel(_cid: string, freq: string, name: string) {
    const kHz = parseFreqInput(freq);
    if (kHz == null) return Promise.reject(new Error('Enter a frequency like 59.5'));
    const freqErr = validateFrequency(kHz);
    if (freqErr) return Promise.reject(new Error(freqErr));
    const label = name.trim();
    if (!label) return Promise.reject(new Error('Name the channel'));
    if (this.channelsList.some((c) => c.freqKHz === kHz)) return Promise.reject(new Error('That frequency is already in use'));
    if (this.channelsList.some((c) => c.name.toLowerCase() === label.toLowerCase())) return Promise.reject(new Error('That name is already in use'));
    const channel: ChannelInfo = {
      id: `ch${kHz}`,
      freqKHz: kHz,
      freq: formatFreqKHz(kHz),
      name: label,
      restricted: false,
    };
    this.channelsList = [...this.channelsList, channel].sort((a, b) => a.freqKHz - b.freqKHz);
    return Promise.resolve(channel);
  }

  deleteChannel(_cid: string, chid: string) {
    this.channelsList = this.channelsList.filter((c) => c.id !== chid);
    return Promise.resolve();
  }

  deleteCommunity() {
    this.channelsList = [];
    return Promise.resolve();
  }

  tokens() {
    return Promise.resolve({ livekitUrl: 'ws://preview.invalid', grants: [] });
  }

  devices() { return Promise.resolve([]); }
  invites() { return Promise.resolve([]); }
  claimAdmin() { return Promise.resolve({ role: 'admin' as const, deviceId: 'preview' }); }
  revokeDevice() { return Promise.resolve({ deviceId: 'preview', revokedAt: new Date().toISOString() }); }
  restoreDevice() { return Promise.resolve({ deviceId: 'preview', revokedAt: null }); }
  setDeviceRole(_cid: string, deviceId: string, role: 'admin' | 'member') { return Promise.resolve({ deviceId, role }); }
  createInvite() { return Promise.resolve({ id: 'preview', code: 'K7QM-2XPA', label: null, createdAt: '', createdBy: 'admin-key', maxUses: null, uses: 0, expiresAt: null, revokedAt: null }); }
  revokeInvite() { return Promise.resolve({ id: 'preview', code: 'K7QM-2XPA', label: null, createdAt: '', createdBy: 'admin-key', maxUses: null, uses: 0, expiresAt: null, revokedAt: new Date().toISOString() }); }
}
