import { describe, expect, it } from 'vitest';
import { HELPER_HTTP, HELPER_WS, PAGES_CSP, PREVIEW_CSP, cspSources, injectCsp } from './pagesCsp';

describe('Pages CSP', () => {
  it('pins Sydney and the helper port, with no connect wildcard', () => {
    const connect = cspSources(PAGES_CSP, 'connect-src');
    expect(connect).toContain('https://radio-149-28-170-200.sslip.io');
    expect(connect).toContain('wss://lk-149-28-170-200.sslip.io');
    expect(connect).toContain(HELPER_WS);
    expect(connect).toContain(HELPER_HTTP);
    expect(connect).not.toContain('https:');
    expect(connect).not.toContain('wss:');
    expect(connect).not.toContain('ws:');
    expect(cspSources(PAGES_CSP, 'script-src')).toEqual(["'self'"]);
    expect(PAGES_CSP).not.toContain('unsafe-eval');
    expect(PAGES_CSP).not.toContain('frame-ancestors');
    expect(cspSources(PAGES_CSP, 'object-src')).toEqual(["'none'"]);
    expect(cspSources(PAGES_CSP, 'base-uri')).toEqual(["'self'"]);
  });

  it('keeps the mock preview from calling out', () => {
    expect(cspSources(PREVIEW_CSP, 'connect-src')).toEqual(["'none'"]);
    const html = injectCsp('<head><title>x</title></head>', PREVIEW_CSP);
    expect(html).toContain(PREVIEW_CSP);
    expect(injectCsp(html, PREVIEW_CSP)).toBe(html);
  });
});
