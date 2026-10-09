import { describe, expect, it } from 'vitest';
import { isAllowedApiOrigin, PAGES_ORIGIN } from '../src/cors.js';

describe('API origin allowlist', () => {
  it('allows the Pages site, loopback, and a missing origin', () => {
    expect(isAllowedApiOrigin(undefined)).toBe(true);
    expect(isAllowedApiOrigin(null)).toBe(true);
    expect(isAllowedApiOrigin('')).toBe(true);
    expect(isAllowedApiOrigin('null')).toBe(true);
    expect(isAllowedApiOrigin(PAGES_ORIGIN)).toBe(true);
    expect(isAllowedApiOrigin('http://localhost:5173')).toBe(true);
    expect(isAllowedApiOrigin('http://127.0.0.1:8787')).toBe(true);
    expect(isAllowedApiOrigin('https://localhost')).toBe(true);
  });

  it('rejects lookalike hosts and other websites', () => {
    expect(isAllowedApiOrigin('https://tubss2.github.io.evil.example')).toBe(false);
    expect(isAllowedApiOrigin('http://tubss2.github.io')).toBe(false);
    expect(isAllowedApiOrigin('https://evil.github.io')).toBe(false);
    expect(isAllowedApiOrigin('https://tubss2.github.io/radio-net')).toBe(false);
    expect(isAllowedApiOrigin('https://evil.example')).toBe(false);
    expect(isAllowedApiOrigin('http://127.0.0.1.evil.example')).toBe(false);
    expect(isAllowedApiOrigin('http://localhost.evil.example')).toBe(false);
  });
});
