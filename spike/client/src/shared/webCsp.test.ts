import { describe, expect, it } from 'vitest';
import { HELPER_HTTP, HELPER_WS, PREVIEW_CSP, SYDNEY_API_ORIGIN, SYDNEY_LIVEKIT_WS, WEB_CSP, cspDirective, injectPreviewCsp } from './webCsp';

describe('Pages CSP', () => {
  it('pins the Sydney hosts and the helper port, with no connect wildcard', () => {
    const connect = cspDirective(WEB_CSP, 'connect-src');
    expect(connect).toContain(SYDNEY_API_ORIGIN);
    expect(connect).toContain(SYDNEY_LIVEKIT_WS);
    expect(connect).toContain(HELPER_WS);
    expect(connect).toContain(HELPER_HTTP);
    expect(connect).not.toContain('https:');
    expect(connect).not.toContain('wss:');
    expect(connect).not.toContain('ws:');
    expect(connect).not.toContain('http:');
  });

  it('allows scripts only from this origin and does not pretend to set frame-ancestors', () => {
    expect(cspDirective(WEB_CSP, 'script-src')).toEqual(["'self'"]);
    expect(WEB_CSP).not.toContain('unsafe-eval');
    expect(WEB_CSP).not.toContain('frame-ancestors');
    expect(cspDirective(WEB_CSP, 'script-src').join(' ')).not.toContain('unsafe-inline');
    expect(cspDirective(WEB_CSP, 'style-src')).toContain("'unsafe-inline'");
  });

  it('keeps the mock preview from calling anything', () => {
    expect(cspDirective(PREVIEW_CSP, 'connect-src')).toEqual(["'none'"]);
    expect(PREVIEW_CSP).not.toContain(SYDNEY_API_ORIGIN);
    expect(PREVIEW_CSP).not.toContain(HELPER_WS);
    const html = injectPreviewCsp('<html><head><title>x</title></head><body></body></html>');
    expect(html).toContain(`content="${PREVIEW_CSP}"`);
    expect(injectPreviewCsp(html)).toBe(html);
  });
});
