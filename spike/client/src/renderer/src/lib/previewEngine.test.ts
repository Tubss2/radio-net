import { describe, expect, it } from 'vitest';
import { resolveLivekitUrl } from './livekitUrl';
import { PreviewApi } from './previewApi';
import { PreviewEngine } from './previewEngine';

describe('baked LiveKit URL', () => {
  it('uses the build-time URL when one was provided', () => {
    expect(resolveLivekitUrl('ws://from-api', 'wss://lk-149-28-170-200.sslip.io')).toBe('wss://lk-149-28-170-200.sslip.io');
    expect(resolveLivekitUrl('ws://from-api', '')).toBe('ws://from-api');
    expect(resolveLivekitUrl('ws://from-api')).toBe('ws://from-api');
  });
});

describe('preview radio', () => {
  it('tunes without a server, shows a talker, and keys the local user', async () => {
    const engine = new PreviewEngine();
    const api = new PreviewApi();
    const channels = await api.channels();
    expect(channels.map((c) => c.name)).toEqual(['Arty', 'Logi', 'Command', 'Alpha FT', 'Bravo FT']);
    await engine.tune(channels[2]);
    await engine.demo('one');
    expect(engine.tuned[0].speakers).toEqual(['Rhys']);
    expect(engine.tuned[0].channel.freq).toBe('59.500');
    await engine.demo('you');
    expect(engine.transmittingOn).toBe('cmd');
    await engine.ptt(false);
    expect(engine.transmittingOn).toBeNull();
    await engine.demo('silence');
    expect(engine.tuned.every((t) => t.speakers.length === 0)).toBe(true);
    await engine.dispose();
  });

  it('steps frequency-style talkers only while auto is on', async () => {
    const engine = new PreviewEngine();
    const api = new PreviewApi();
    const [arty, , cmd] = await api.channels();
    await engine.tune(arty);
    await engine.tune(cmd);
    await engine.demo('silence');
    engine.stepTalkers();
    expect(engine.tuned.every((t) => t.speakers.length === 0)).toBe(true);
    await engine.demo('auto');
    expect(engine.tuned.some((t) => t.speakers.length > 0)).toBe(true);
    await engine.dispose();
  });
});
