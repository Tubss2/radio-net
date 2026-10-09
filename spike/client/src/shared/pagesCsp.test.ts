import { describe, expect, it } from 'vitest';
import { HELPER_URL } from './helperLink';
import { HELPER_HTTP, HELPER_WS, PAGES_CSP, cspSources } from './pagesCsp';

describe('Pages CSP', () => {
  it('pins Sydney and the helper port, with no connect wildcard', () => {
    const connect = cspSources(PAGES_CSP, 'connect-src');
    expect(connect).toContain(HELPER_WS);
    expect(connect).toContain(HELPER_HTTP);
    expect(HELPER_WS).toBe(HELPER_URL);
    expect(connect).not.toContain('https:');
    expect(connect).not.toContain('wss:');
    expect(connect).not.toContain('ws:');
    expect(cspSources(PAGES_CSP, 'script-src')).toEqual(["'self'"]);
    expect(PAGES_CSP).not.toContain('unsafe-eval');
    expect(PAGES_CSP).not.toContain('frame-ancestors');
    expect(cspSources(PAGES_CSP, 'object-src')).toEqual(["'none'"]);
  });
});
