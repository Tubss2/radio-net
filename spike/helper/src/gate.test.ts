import { describe, expect, it } from 'vitest';
import {
  HELPER_PORT, HelperGate, isAllowedHelperOrigin, isLoopbackHost, newHelperSecret, privateNetworkHeaders, talkMessage, upgradeAllowed,
} from './gate.js';

describe('helper origin and host', () => {
  it('allows the Pages site and loopback dev, and rejects everything else', () => {
    expect(isAllowedHelperOrigin('https://tubss2.github.io')).toBe(true);
    expect(isAllowedHelperOrigin('http://127.0.0.1:5173')).toBe(true);
    expect(isAllowedHelperOrigin('http://localhost:5174')).toBe(true);
    expect(isAllowedHelperOrigin(undefined)).toBe(false);
    expect(isAllowedHelperOrigin('null')).toBe(false);
    expect(isAllowedHelperOrigin('https://evil.example')).toBe(false);
    expect(isAllowedHelperOrigin('https://tubss2.github.io.evil.example')).toBe(false);
    expect(isAllowedHelperOrigin('http://tubss2.github.io')).toBe(false);
  });

  it('rejects a rebound name that is not loopback', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost(`localhost:${HELPER_PORT}`)).toBe(true);
    expect(isLoopbackHost('127.0.0.1:1')).toBe(true);
    expect(isLoopbackHost('evil.example')).toBe(false);
    expect(isLoopbackHost(`evil.example:${HELPER_PORT}`)).toBe(false);
    expect(isLoopbackHost('127.0.0.1.evil.example')).toBe(false);
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
    expect(isLoopbackHost(undefined)).toBe(false);
  });

  it('sends Private Network Access only for an allowlisted origin', () => {
    const ok = privateNetworkHeaders('https://tubss2.github.io');
    expect(ok?.['Access-Control-Allow-Origin']).toBe('https://tubss2.github.io');
    expect(ok?.['Access-Control-Allow-Private-Network']).toBe('true');
    expect(JSON.stringify(ok)).not.toContain('*');
    expect(privateNetworkHeaders('https://evil.example')).toBeNull();
    expect(privateNetworkHeaders(undefined)).toBeNull();
  });

  it('requires both checks before a WebSocket upgrade', () => {
    expect(upgradeAllowed('https://tubss2.github.io', `127.0.0.1:${HELPER_PORT}`)).toBe(true);
    expect(upgradeAllowed('https://evil.example', `127.0.0.1:${HELPER_PORT}`)).toBe(false);
    expect(upgradeAllowed('https://tubss2.github.io', 'evil.example')).toBe(false);
  });
});

describe('helper pairing secret', () => {
  it('is 32 bytes and burns on the first success only', () => {
    const secret = newHelperSecret();
    expect(Buffer.from(secret, 'base64url')).toHaveLength(32);
    const gate = new HelperGate(secret);
    expect(gate.authorize('nope')).toBe(false);
    expect(gate.spent).toBe(false);
    expect(gate.authorize(secret)).toBe(true);
    expect(gate.authorize(secret)).toBe(false);
  });

  it('talk messages carry up or down and no key code', () => {
    expect(Object.keys(JSON.parse(talkMessage(true)))).toEqual(['type', 'down']);
    expect(JSON.parse(talkMessage(false))).toEqual({ type: 'talk', down: false });
  });
});
