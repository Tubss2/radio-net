import { describe, expect, it } from 'vitest';
import { removedTunedIds } from '../../../shared/channelList';
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
    expect(engine.tuned[0].channel.freq).toBe('59.5');
    await engine.demo('you');
    expect(engine.transmittingOn).toBe('cmd');
    await engine.ptt(false);
    expect(engine.transmittingOn).toBeNull();
    await engine.demo('silence');
    expect(engine.tuned.every((t) => t.speakers.length === 0)).toBe(true);
    await engine.dispose();
  });

  it('drops a deleted channel from the list and from the radio', async () => {
    const api = new PreviewApi();
    const engine = new PreviewEngine();
    const channels = await api.channels();
    const logi = channels.find((c) => c.id === 'logi');
    const cmd = channels.find((c) => c.id === 'cmd');
    if (!logi || !cmd) throw new Error('preview channels missing');
    await engine.tune(logi);
    await engine.tune(cmd);
    engine.setTx('logi');
    await api.deleteChannel('wdnz', 'logi');
    const left = await api.channels();
    expect(left.map((c) => c.id)).not.toContain('logi');
    expect(left.map((c) => c.name)).toContain('Command');
    for (const id of removedTunedIds(engine.tuned.map((t) => t.channel.id), left.map((c) => c.id))) {
      await engine.untune(id);
    }
    expect(engine.tuned.map((t) => t.channel.id)).toEqual(['cmd']);
    expect(engine.txId).toBe('cmd');
    await engine.dispose();
  });

  it('steps the talk channel forward and back', async () => {
    const engine = new PreviewEngine();
    const api = new PreviewApi();
    const channels = await api.channels();
    const logi = channels.find((c) => c.id === 'logi');
    const cmd = channels.find((c) => c.id === 'cmd');
    if (!logi || !cmd) throw new Error('preview channels missing');
    await engine.tune(logi);
    await engine.tune(cmd);
    engine.setTx('logi');
    engine.cycle(1);
    expect(engine.txId).not.toBe('logi');
    engine.cycle(-1);
    expect(engine.txId).toBe('logi');
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

  it('keeps the mic open when talk is still held, and refuses another channel during all-call', async () => {
    const engine = new PreviewEngine();
    const api = new PreviewApi();
    const channels = await api.channels();
    const cmd = channels.find((c) => c.id === 'cmd');
    const arty = channels.find((c) => c.id === 'arty');
    if (!cmd || !arty) throw new Error('preview channels missing');
    await engine.tune(cmd);
    await engine.tune(arty);
    engine.setTx('cmd');
    expect(await engine.holdAllCall(true)).toBe(true);
    expect(engine.allCalling).toBe(true);
    expect(engine.transmittingOn).toBe('cmd');
    await engine.ptt(false);
    expect(engine.transmittingOn).toBe('cmd');
    expect(await engine.ptt(true, 'arty')).toBe(false);
    expect(engine.transmittingOn).toBe('cmd');
    await engine.ptt(true);
    await engine.holdAllCall(false);
    expect(engine.allCalling).toBe(false);
    expect(engine.transmittingOn).toBe('cmd');
    await engine.ptt(false);
    expect(engine.transmittingOn).toBeNull();
    expect(await api.allCall('wdnz', { active: true, sourceChannelId: 'cmd', channelIds: ['cmd', 'arty'] })).toEqual({ ok: true });
    await engine.dispose();
  });
});
