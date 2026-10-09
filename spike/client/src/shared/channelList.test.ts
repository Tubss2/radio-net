import { describe, expect, it } from 'vitest';
import { acceptChannelList, removedTunedIds } from './channelList';

describe('channel list after a delete', () => {
  it('ignores a list fetched before the delete', () => {
    const fresh = ['arty', 'cmd'];
    const stale = ['arty', 'logi', 'cmd'];
    expect(acceptChannelList(1, 2, stale)).toBeNull();
    expect(acceptChannelList(2, 2, fresh)).toEqual(fresh);
    expect(acceptChannelList(3, 3, [] as string[])).toEqual([]);
  });

  it('names the tuned channels the server no longer has', () => {
    expect(removedTunedIds(['arty', 'logi', 'cmd'], ['arty', 'cmd'])).toEqual(['logi']);
    expect(removedTunedIds(['arty'], ['arty', 'logi'])).toEqual([]);
    expect(removedTunedIds(['arty', 'logi'], [])).toEqual(['arty', 'logi']);
  });
});
