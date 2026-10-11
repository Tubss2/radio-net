import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCodec2 } from './codec2';

describe('Codec2 2400 module', () => {
  it('is a separate WASM build that round-trips 20 ms frames', async () => {
    const bytes = readFileSync(join(import.meta.dirname, 'codec2.wasm'));
    const module = await loadCodec2(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const voice = module.open();
    expect(voice.samplesPerFrame).toBe(160);
    expect(voice.bytesPerFrame).toBe(6);
    const pcm = new Int16Array(320);
    for (let i = 0; i < pcm.length; i++) pcm[i] = (Math.sin((2 * Math.PI * 400 * i) / 8000) * 8000) | 0;
    const out = voice.process(pcm);
    expect(out.length).toBe(320);
    let energy = 0;
    for (let i = 0; i < out.length; i++) energy += out[i] * out[i];
    expect(energy).toBeGreaterThan(1000);
    const again = voice.process(pcm);
    expect(again[40]).not.toBe(pcm[40]);
    voice.close();
  });
});
