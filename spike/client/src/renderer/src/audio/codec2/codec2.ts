/**
 * Codec2 2400, loaded from the separate WASM module next to this file.
 * One instance is shared by every Digital voice in the worklet. Each voice
 * calls open() so the encoder state stays per speaker. LGPL-2.1: see LICENSE.
 */

export interface Codec2Voice {
  samplesPerFrame: number;
  bytesPerFrame: number;
  process(pcm: Int16Array): Int16Array;
  close(): void;
}

export interface Codec2Module {
  open(): Codec2Voice;
}

interface WasmExports {
  memory: WebAssembly.Memory;
  c2_open: () => number;
  c2_close: (ptr: number) => void;
  c2_samples: (ptr: number) => number;
  c2_bytes: (ptr: number) => number;
  c2_in: (ptr: number) => number;
  c2_out: (ptr: number) => number;
  c2_process: (ptr: number, frames: number) => void;
}

const wasi = {
  wasi_snapshot_preview1: {
    fd_write: () => 0,
    fd_close: () => 0,
    fd_seek: () => 0,
  },
};

export async function loadCodec2(bytes: ArrayBuffer): Promise<Codec2Module> {
  const { instance } = await WebAssembly.instantiate(bytes, wasi);
  const api = instance.exports as unknown as WasmExports;
  return {
    open() {
      const ptr = api.c2_open();
      if (!ptr) throw new Error('Codec2 did not start');
      const samplesPerFrame = api.c2_samples(ptr);
      const bytesPerFrame = api.c2_bytes(ptr);
      return {
        samplesPerFrame,
        bytesPerFrame,
        process(pcm: Int16Array) {
          const frames = Math.max(1, Math.round(pcm.length / samplesPerFrame));
          const needed = frames * samplesPerFrame;
          const heap = new Int16Array(api.memory.buffer);
          const inn = api.c2_in(ptr) >> 1;
          const out = api.c2_out(ptr) >> 1;
          for (let i = 0; i < needed; i++) heap[inn + i] = pcm[i] ?? 0;
          api.c2_process(ptr, frames);
          return new Int16Array(heap.subarray(out, out + needed));
        },
        close() {
          api.c2_close(ptr);
        },
      };
    },
  };
}
