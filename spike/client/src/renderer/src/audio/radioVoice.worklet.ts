import { VoiceColour, type RadioFilterPreset } from '../../../shared/radioFilter';
import { loadCodec2, type Codec2Module, type Codec2Voice } from './codec2/codec2';

/**
 * One processor per remote voice. Codec2 is one WASM instance for the whole
 * worklet; each Digital voice opens its own encoder state.
 */
const PROCESSOR = 'radio-net-voice';

let codecModule: Promise<Codec2Module> | null = null;

function sharedCodec(bytes: ArrayBuffer): Promise<Codec2Module> {
  if (!codecModule) codecModule = loadCodec2(bytes);
  return codecModule;
}

class RadioVoiceProcessor extends AudioWorkletProcessor {
  private colour: VoiceColour;
  private codec: Codec2Voice | null = null;

  constructor() {
    super();
    this.colour = new VoiceColour(sampleRate, 'handheld');
    this.port.onmessage = (event: MessageEvent<{ type?: string; preset?: RadioFilterPreset; on?: boolean; bytes?: ArrayBuffer }>) => {
      const data = event.data;
      if (!data || typeof data.type !== 'string') return;
      if (data.type === 'preset' && (data.preset === 'handheld' || data.preset === 'degraded' || data.preset === 'digital')) {
        this.colour.setPreset(data.preset);
        return;
      }
      if (data.type === 'carrier') {
        this.colour.carrier = data.on === true;
        return;
      }
      if (data.type === 'wasm' && data.bytes) {
        void sharedCodec(data.bytes).then((mod) => {
          this.codec?.close();
          this.codec = mod.open();
          this.colour.codec = this.codec;
        }).catch(() => {
          this.colour.codec = null;
        });
      }
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0]?.[0];
    if (!output) return true;
    const input = inputs[0]?.[0];
    if (!input) {
      output.fill(0);
      return true;
    }
    this.colour.processInto(input, output);
    return true;
  }
}

registerProcessor(PROCESSOR, RadioVoiceProcessor);
