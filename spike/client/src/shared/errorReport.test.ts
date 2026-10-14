import { describe, expect, it } from 'vitest';
import { buildErrorReport } from './errorReport';

describe('buildErrorReport', () => {
  it('keeps the page path and strips secrets, query strings, and audio', () => {
    const report = buildErrorReport({
      message: 'failed Bearer abc.def token rnk_supersecret',
      stack: 'Error\n at https://radio.example/app.js?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.signature',
      source: 'window',
      appVersion: '0.4.9',
      surface: 'web',
      userAgent: 'Mozilla/5.0 Chrome/130.0.0.0',
      href: 'https://tubss2.github.io/radio-net/?invite=SECRET#code',
    });
    expect(report.message).not.toMatch(/abc\.def|rnk_supersecret/);
    expect(report.message).toContain('Bearer [redacted]');
    expect(report.stack).not.toContain('token=');
    expect(report.stack).not.toContain('eyJ');
    expect(report.path).toBe('/radio-net/');
    expect(report.browser).toBe('Chrome 130');
    expect(JSON.stringify(report)).not.toMatch(/audio|callsign|invite/i);
  });

  it('uses a slash when the page address is not a URL', () => {
    const report = buildErrorReport({
      message: 'boom',
      source: 'unhandledrejection',
      appVersion: '0.4.9',
      surface: 'electron',
      userAgent: 'other',
      href: 'not a url',
    });
    expect(report.path).toBe('/');
    expect(report.browser).toBe('unknown');
  });
});
