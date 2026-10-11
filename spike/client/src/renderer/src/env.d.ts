declare module '*.css';
declare module '*.wav?url' {
  const src: string;
  export default src;
}

declare module '*.wasm?url' {
  const src: string;
  export default src;
}

declare module '*?worker&url' {
  const src: string;
  export default src;
}

/**
 * Audio worklet globals. This client's TypeScript DOM lib does not declare
 * the processor base class, so the worklet file names it here.
 */
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}
declare const sampleRate: number;
declare function registerProcessor(name: string, processorCtor: new () => AudioWorkletProcessor): void;

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_LIVEKIT_URL?: string;
  readonly MODE: string;
  readonly BASE_URL: string;
  readonly PROD: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
