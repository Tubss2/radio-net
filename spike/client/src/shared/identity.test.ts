import { describe, expect, it } from 'vitest';
import { canonicalJoin, tokenHasDevice } from './identity';

describe('device identity', () => {
  it('builds the sign-in string the server checks, with no trailing newline', () => {
    const message = canonicalJoin('c', 'n', 'community', 'ab');
    expect(message).toBe('rn-join.v1\nc\nn\ncommunity\nab');
    expect(message.endsWith('\n')).toBe(false);
  });

  it('recognises a session that already names a device', () => {
    const deviceId = 'ab'.repeat(32);
    const header = Buffer.from(JSON.stringify({ did: deviceId, sid: 'x' })).toString('base64url');
    expect(tokenHasDevice(`${header}.mac`)).toBe(true);
    expect(tokenHasDevice(`${Buffer.from(JSON.stringify({ sid: 'only' })).toString('base64url')}.mac`)).toBe(false);
    expect(tokenHasDevice('not-a-token')).toBe(false);
  });
});
