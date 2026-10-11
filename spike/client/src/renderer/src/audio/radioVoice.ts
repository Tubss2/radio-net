import codec2Url from './codec2/codec2.wasm?url';
import workletUrl from './radioVoice.worklet.ts?worker&url';

export const RADIO_WORKLET = 'radio-net-voice';

export function radioWorkletUrl(): string {
  return workletUrl;
}

let wasmBytes: Promise<ArrayBuffer> | null = null;

/** The LGPL Codec2 module, fetched once from this app's own files. */
export function codec2Bytes(): Promise<ArrayBuffer> {
  if (!wasmBytes) {
    wasmBytes = fetch(codec2Url).then((res) => {
      if (!res.ok) throw new Error('Codec2 module did not load');
      return res.arrayBuffer();
    });
  }
  return wasmBytes;
}
