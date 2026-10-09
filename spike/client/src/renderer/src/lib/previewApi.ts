import { formatFreqKHz, parseFreqInput, validateFrequency } from '../../../shared/freq';
import { Api, type ChannelInfo, type CommunityInfo } from './api';

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
  role: 'owner',
  inviteCode: 'K7QM-2XPA',
});

/** Fake server: one community and a handful of channels. No network. */
export class PreviewApi extends Api {
  constructor() {
    super('preview');
  }

  channelsList: ChannelInfo[] = PREVIEW_CHANNELS.map((c) => ({ ...c }));

  me() {
    return Promise.resolve({
      account: { id: 'toby', displayName: 'Toby' },
      communities: [community()],
    });
  }

  join() {
    return Promise.resolve({ token: 'preview', community: community() });
  }

  createCommunity(name: string) {
    return Promise.resolve({ token: 'preview', community: { ...community(), name: name || community().name } });
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

  tokens() {
    return Promise.resolve({ livekitUrl: 'ws://preview.invalid', grants: [] });
  }
}
