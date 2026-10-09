import { describe, expect, it } from 'vitest';
import { signSession, verifySession } from '../src/accounts.js';
import {
  PAIRING_TTL_MS, PTT_TTL_SECONDS, PairingTable, hashPairingSecret, issuePttToken, newPairingSecret, pairingUrl, verifyPtt,
} from '../src/pairing.js';

const parent = { cid: 'wdnz', parentSid: 'sid-parent', epoch: 3 };

describe('phone pairing', () => {
  it('puts 32 bytes in the fragment and stores only the hash', () => {
    let now = 1_000_000;
    const table = new PairingTable(() => now);
    const issued = table.issue(parent);
    expect(Buffer.from(issued.secret, 'base64url')).toHaveLength(32);
    expect(issued.fragment).toBe(`#pair=${issued.secret}`);
    expect(table.storedHashes()).toEqual([hashPairingSecret(issued.secret)]);
    expect(table.storedHashes()[0]).not.toContain(issued.secret);

    const url = new URL(pairingUrl('https://tubss2.github.io/radio-net/?pair=leaked', issued.secret));
    expect(url.search).toBe('');
    expect(url.hash).toBe(`#pair=${issued.secret}`);
    expect(url.toString()).not.toContain('?pair=');
  });

  it('is single use and dies after two minutes', () => {
    let now = 5_000;
    const table = new PairingTable(() => now);
    const { secret } = table.issue(parent);
    expect(table.redeem('wrong-secret')).toBeNull();
    expect(table.redeem(secret)).toEqual(parent);
    expect(table.redeem(secret)).toBeNull();
    expect(table.storedHashes()).toEqual([]);

    const second = table.issue(parent);
    now += PAIRING_TTL_MS;
    expect(table.redeem(second.secret)).toBeNull();
  });

  it('mints a ptt token bound to the parent epoch, and a member session rejects it', () => {
    const secret = 'server-secret-server-secret';
    const now = 1_800_000_000;
    const { token, session } = issuePttToken(parent, secret, now);
    expect(session.scope).toBe('ptt');
    expect(session.exp - session.iat).toBe(PTT_TTL_SECONDS);
    expect(verifyPtt(token, secret, { epoch: parent.epoch, now: now + 10 })).toMatchObject({
      scope: 'ptt', cid: parent.cid, parentSid: parent.parentSid, epoch: parent.epoch,
    });
    expect(verifyPtt(token, secret, { epoch: parent.epoch + 1, now: now + 10 })).toBeNull();
    expect(verifyPtt(token, secret, { epoch: parent.epoch, now: session.exp })).toBeNull();
    expect(verifyPtt(token, 'other-secret-other-secret', { now: now + 10 })).toBeNull();
    expect(verifySession(token, secret)).toBeNull();
    expect(verifySession(token.slice('ptt.'.length), secret)).toBeNull();

    const member = signSession({ cid: parent.cid, name: 'Rifleman', sid: parent.parentSid, exp: now + 60 }, secret);
    expect(verifyPtt(member, secret, { now })).toBeNull();
    expect(verifySession(member, secret)?.sid).toBe(parent.parentSid);
  });

  it('refuses to issue a pair without a parent session', () => {
    const table = new PairingTable(() => 0);
    expect(() => table.issue({ cid: '', parentSid: 'x', epoch: 0 })).toThrow();
    expect(newPairingSecret()).not.toContain('+');
  });
});
