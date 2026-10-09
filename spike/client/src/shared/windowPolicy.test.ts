import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RENDERER_CSP, isAllowedAppUrl, rendererWebPreferences, shouldAllowMedia } from './windowPolicy';

describe('window policy', () => {
  it('locks the renderer down and matches the HTML CSP', () => {
    const prefs = rendererWebPreferences('/preload.js');
    expect(prefs.contextIsolation).toBe(true);
    expect(prefs.nodeIntegration).toBe(false);
    expect(prefs.sandbox).toBe(true);
    expect(prefs.webSecurity).toBe(true);
    expect(prefs.allowRunningInsecureContent).toBe(false);
    const html = readFileSync(join(import.meta.dirname, '../renderer/index.html'), 'utf8');
    const overlay = readFileSync(join(import.meta.dirname, '../renderer/overlay.html'), 'utf8');
    expect(html).toContain(RENDERER_CSP);
    expect(overlay).toContain(RENDERER_CSP);
    expect(RENDERER_CSP).toContain("object-src 'none'");
    expect(RENDERER_CSP).toContain("frame-ancestors 'none'");
  });

  it('allows only the app pages', () => {
    expect(isAllowedAppUrl('file:///C:/Radio%20Net/resources/app.asar/out/renderer/index.html')).toBe(true);
    expect(isAllowedAppUrl('file:///tmp/overlay.html')).toBe(true);
    expect(isAllowedAppUrl('https://example.com/index.html')).toBe(false);
    expect(isAllowedAppUrl('http://localhost:5173/index.html', 'http://localhost:5173')).toBe(true);
    expect(isAllowedAppUrl('http://localhost:5173/overlay.html', 'http://localhost:5173')).toBe(true);
    expect(isAllowedAppUrl('http://evil.example/index.html', 'http://localhost:5173')).toBe(false);
  });

  it('allows the microphone and denies the camera', () => {
    expect(shouldAllowMedia('media')).toBe(true);
    expect(shouldAllowMedia('media', ['audio'])).toBe(true);
    expect(shouldAllowMedia('media', ['video'])).toBe(false);
    expect(shouldAllowMedia('media', ['audio', 'video'])).toBe(false);
    expect(shouldAllowMedia('display-capture')).toBe(false);
    expect(shouldAllowMedia('geolocation')).toBe(false);
  });
});
